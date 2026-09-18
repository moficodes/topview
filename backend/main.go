package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// Constants for WebSocket timeouts (Cloud Run Connection Heartbeats)
const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	// 25 seconds ensures frequent keepalives through cloud proxies and NAT gateways.
	pingPeriod = 25 * time.Second
)

// RoomState defines the state of a room's canvas and visual layout
type RoomState struct {
	RoomID      string  `json:"roomId"`
	ImgURL      string  `json:"imgUrl"`
	X           float64 `json:"x"`           // normalized X position (percentage)
	Y           float64 `json:"y"`           // normalized Y position (percentage)
	Scale       float64 `json:"scale"`       // Zoom scale
	Layout      string  `json:"layout"`      // "1", "2-tb", "2-lr", "3-trb", "3-tlb", "4"
	AspectRatio string  `json:"aspectRatio"`  // e.g., "16:9", "16:10", "4:3", "1:1", "21:9"
}

// SafeConn wraps a WebSocket connection with a mutex to prevent concurrent write panics
// and an outbound channel for asynchronous bounded delivery.
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
	role string
	send chan []byte
}

// WriteMessage is a concurrent-safe wrapper around write calls
func (sc *SafeConn) WriteMessage(messageType int, data []byte) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return sc.conn.WriteMessage(messageType, data)
}

func (sc *SafeConn) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		sc.conn.Close()
	}()

	for {
		select {
		case message, ok := <-sc.send:
			if !ok {
				// The hub closed the channel
				_ = sc.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			if err := sc.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			if err := sc.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Room represents a dynamic room with its state and safe client connections
type Room struct {
	ID      string
	State   RoomState
	Clients map[*SafeConn]string // conn -> role ("admin" or "client")
	mu      sync.Mutex
}

// Hub manages all the rooms
type Hub struct {
	rooms map[string]*Room
	mu    sync.RWMutex
}

var hub = &Hub{
	rooms: make(map[string]*Room),
}

// WSMessage represents the structure of messages exchanged over WebSockets
type WSMessage struct {
	Type    string    `json:"type"` // "init", "state_update", "ping", "pong"
	Payload RoomState `json:"payload,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins for tabletop networks and remote displays
		return true
	},
}

func (h *Hub) getOrCreateRoom(roomID string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, exists := h.rooms[roomID]
	if !exists {
		room = &Room{
			ID: roomID,
			State: RoomState{
				RoomID:      roomID,
				ImgURL:      "",
				X:           0.0,
				Y:           0.0,
				Scale:       1.0,
				Layout:      "1",
				AspectRatio: "16:9",
			},
			Clients: make(map[*SafeConn]string),
		}
		h.rooms[roomID] = room
		log.Printf("Created new room: %s", roomID)
	}
	return room
}

func (h *Hub) removeConnection(roomID string, sc *SafeConn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, exists := h.rooms[roomID]
	if !exists {
		return
	}

	room.mu.Lock()
	if _, ok := room.Clients[sc]; ok {
		delete(room.Clients, sc)
		close(sc.send)
	}
	clientCount := len(room.Clients)
	room.mu.Unlock()

	log.Printf("Disconnected client from room %s. Active clients: %d", roomID, clientCount)

	// Clean up empty rooms atomically under h.mu
	if clientCount == 0 {
		delete(h.rooms, roomID)
		log.Printf("Cleaned up empty room: %s", roomID)
	}
}

var uploadDir = "./uploads"

func validateRoomState(s *RoomState) {
	if math.IsNaN(s.X) || math.IsInf(s.X, 0) {
		s.X = 0.0
	}
	if math.IsNaN(s.Y) || math.IsInf(s.Y, 0) {
		s.Y = 0.0
	}
	if math.IsNaN(s.Scale) || math.IsInf(s.Scale, 0) {
		s.Scale = 1.0
	} else if s.Scale < 0.1 {
		s.Scale = 0.1
	} else if s.Scale > 15.0 {
		s.Scale = 15.0
	}

	switch s.Layout {
	case "1", "2-tb", "2-lr", "3-trb", "3-tlb", "4":
		// valid
	default:
		s.Layout = "1"
	}

	switch s.AspectRatio {
	case "16:9", "16:10", "4:3", "1:1", "21:9":
		// valid
	default:
		s.AspectRatio = "16:9"
	}
}

func setupMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")

		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		}
		if r.Method == "OPTIONS" {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Handle WebSocket connection
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	role := r.URL.Query().Get("role") // "admin" or "client"

	if roomID == "" {
		http.Error(w, "roomId query parameter is required", http.StatusBadRequest)
		return
	}
	if role != "admin" {
		role = "client"
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	
	// Create safe wrapped connection
	safeConn := &SafeConn{
		conn: conn,
		role: role,
		send: make(chan []byte, 32),
	}
	defer conn.Close()

	room := hub.getOrCreateRoom(roomID)

	// Configure WebSocket Heartbeat limits on raw conn (Cloud Run Compliance)
	conn.SetReadLimit(10 << 20) // 10MB limit
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Register client and queue initial state under room.mu atomically
	room.mu.Lock()
	room.Clients[safeConn] = role
	clientCount := len(room.Clients)
	initMsg := WSMessage{
		Type:    "init",
		Payload: room.State,
	}
	if initBytes, err := json.Marshal(initMsg); err == nil {
		safeConn.send <- initBytes
	}
	room.mu.Unlock()

	// Start write pump goroutine for this specific connection
	go safeConn.writePump()

	defer hub.removeConnection(roomID, safeConn)

	log.Printf("Connected %s to room %s. Total connections in room: %d", role, roomID, clientCount)

	// Read loop
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error in room %s: %v", roomID, err)
			}
			break
		}

		// Reset read deadline on any received traffic
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("JSON unmarshal error in room %s: %v", roomID, err)
			continue
		}

		switch msg.Type {
		case "state_update":
			if safeConn.role != "admin" {
				log.Printf("Ignoring unauthorized state_update from %s in room %s", safeConn.role, roomID)
				continue
			}

			validateRoomState(&msg.Payload)

			room.mu.Lock()
			room.State = msg.Payload
			room.State.RoomID = roomID // ensure room ID is correct
			currentState := room.State
			room.mu.Unlock()

			// Broadcast updated state to all connected clients in the room
			broadcastMsg := WSMessage{
				Type:    "state_update",
				Payload: currentState,
			}
			broadcastBytes, err := json.Marshal(broadcastMsg)
			if err != nil {
				log.Printf("JSON marshal error during broadcast: %v", err)
				continue
			}

			room.mu.Lock()
			for clientConn := range room.Clients {
				// Don't echo back to the same connection that sent it to save bandwidth
				if clientConn == safeConn {
					continue
				}
				select {
				case clientConn.send <- broadcastBytes:
				default:
					// Drop older frame to make room for newest state
					select {
					case <-clientConn.send:
					default:
					}
					select {
					case clientConn.send <- broadcastBytes:
					default:
					}
				}
			}
			room.mu.Unlock()

		case "ping":
			select {
			case safeConn.send <- []byte(`{"type":"pong"}`):
			default:
			}
		}
	}
}

// Handle file uploads
func handleUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)

	if err := r.ParseMultipartForm(20 << 20); err != nil {
		http.Error(w, fmt.Sprintf("Error parsing upload: %v", err), http.StatusBadRequest)
		return
	}

	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, fmt.Sprintf("Error retrieving file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(handler.Filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp":
		// valid extension
	default:
		http.Error(w, "Invalid file extension", http.StatusBadRequest)
		return
	}

	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && err != io.EOF {
		http.Error(w, "Failed to read file", http.StatusBadRequest)
		return
	}
	if n == 0 {
		http.Error(w, "File is empty", http.StatusBadRequest)
		return
	}

	mimeType := http.DetectContentType(buf[:n])
	if !strings.HasPrefix(mimeType, "image/jpeg") &&
		!strings.HasPrefix(mimeType, "image/png") &&
		!strings.HasPrefix(mimeType, "image/webp") {
		http.Error(w, "Invalid file content type", http.StatusBadRequest)
		return
	}

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		http.Error(w, "Failed to seek file", http.StatusInternalServerError)
		return
	}

	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		http.Error(w, "Failed to create uploads directory", http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	filePath := filepath.Join(uploadDir, filename)

	targetFile, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0666)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, file); err != nil {
		http.Error(w, "Failed to write file contents", http.StatusInternalServerError)
		return
	}

	resp := map[string]string{
		"url": fmt.Sprintf("/uploads/%s", filename),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// API endpoint to list active rooms
func handleRoomsList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	hub.mu.RLock()
	defer hub.mu.RUnlock()

	type RoomInfo struct {
		ID          string    `json:"id"`
		Layout      string    `json:"layout"`
		ImgURL      string    `json:"imgUrl"`
		ClientCount int       `json:"clientCount"`
	}

	rooms := make([]RoomInfo, 0, len(hub.rooms))
	for id, room := range hub.rooms {
		room.mu.Lock()
		rooms = append(rooms, RoomInfo{
			ID:          id,
			Layout:      room.State.Layout,
			ImgURL:      room.State.ImgURL,
			ClientCount: len(room.Clients),
		})
		room.mu.Unlock()
	}

	json.NewEncoder(w).Encode(rooms)
}

// SPA Static File Server fallback
type spaHandler struct {
	staticPath string
	indexPath  string
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path, err := filepath.Abs(r.URL.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	path = filepath.Join(h.staticPath, path)

	fi, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(h.staticPath, h.indexPath))
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if fi.IsDir() {
		http.ServeFile(w, r, filepath.Join(h.staticPath, h.indexPath))
		return
	}

	http.FileServer(http.Dir(h.staticPath)).ServeHTTP(w, r)
}

func main() {
	portVal := 8080
	if envPort := os.Getenv("PORT"); envPort != "" {
		if p, err := strconv.Atoi(envPort); err == nil {
			portVal = p
		}
	}

	port := flag.Int("port", portVal, "Port to run the backend server on")
	flag.Parse()

	if err := os.MkdirAll("./uploads", os.ModePerm); err != nil {
		log.Fatalf("Failed to create uploads directory: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/ws", handleWebSocket)
	mux.HandleFunc("/api/upload", handleUpload)
	mux.HandleFunc("/api/rooms", handleRoomsList)

	fs := http.FileServer(http.Dir("./uploads"))
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", fs))

	distPath := "./dist"
	if _, err := os.Stat(distPath); os.IsNotExist(err) {
		log.Printf("Warning: ./dist directory not found. Please build frontend with 'npm run build'")
	}

	spa := spaHandler{staticPath: distPath, indexPath: "index.html"}
	mux.Handle("/", spa)

	handler := setupMiddleware(mux)

	serverAddr := fmt.Sprintf("0.0.0.0:%d", *port)
	server := &http.Server{
		Addr:    serverAddr,
		Handler: handler,
	}

	// Capture interrupt signals for standard Cloud Run Graceful SIGTERM Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("Starting TopView server on http://%s", serverAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for SIGINT or SIGTERM (Cloud Run scale-down signal)
	sig := <-stop
	log.Printf("Received shutdown signal: %v. Initiating graceful websocket close...", sig)

	// Cleanly disconnect all active presentation screens
	hub.mu.Lock()
	for _, room := range hub.rooms {
		room.mu.Lock()
		for client := range room.Clients {
			_ = client.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "Server shutting down gracefully"))
			client.conn.Close()
		}
		room.mu.Unlock()
	}
	hub.mu.Unlock()

	// Shutdown the HTTP server under 15-second context
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server graceful shutdown error: %v", err)
	} else {
		log.Println("Server gracefully exited.")
	}
}
