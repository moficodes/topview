package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// RoomState defines the state of a room's canvas and visual layout
type RoomState struct {
	RoomID      string  `json:"roomId"`
	ImgURL      string  `json:"imgUrl"`
	X           float64 `json:"x"`           // normalized X position (percentage)
	Y           float64 `json:"y"`           // normalized Y position (percentage)
	Scale       float64 `json:"scale"`       // Zoom scale
	Layout      string  `json:"layout"`      // "1", "2-top-bottom", "2-left-right", "4"
	AspectRatio string  `json:"aspectRatio"`  // e.g., "16:9", "16:10", "4:3", "1:1"
}

// Room represents a dynamic room with its state and connected web sockets
type Room struct {
	ID      string
	State   RoomState
	Clients map[*websocket.Conn]string // conn -> role ("admin" or "client")
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
		// Allow all origins for easy development and network sharing on table screens
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
				ImgURL:      "", // empty initially
				X:           0.0,
				Y:           0.0,
				Scale:       1.0,
				Layout:      "1", // default layout
				AspectRatio: "16:9",
			},
			Clients: make(map[*websocket.Conn]string),
		}
		h.rooms[roomID] = room
		log.Printf("Created new room: %s", roomID)
	}
	return room
}

func (h *Hub) removeConnection(roomID string, conn *websocket.Conn) {
	h.mu.RLock()
	room, exists := h.rooms[roomID]
	h.mu.RUnlock()

	if exists {
		room.mu.Lock()
		delete(room.Clients, conn)
		clientCount := len(room.Clients)
		room.mu.Unlock()

		log.Printf("Disconnected client from room %s. Active clients: %d", roomID, clientCount)

		// Optionally clean up empty rooms after some delay or instantly
		if clientCount == 0 {
			h.mu.Lock()
			delete(h.rooms, roomID)
			h.mu.Unlock()
			log.Printf("Cleaned up empty room: %s", roomID)
		}
	}
}

// Handle WebSocket connection
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	role := r.URL.Query().Get("role") // "admin" or "client"

	if roomID == "" {
		http.Error(w, "roomId query parameter is required", http.StatusBadRequest)
		return
	}
	if role == "" {
		role = "client"
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	room := hub.getOrCreateRoom(roomID)

	room.mu.Lock()
	room.Clients[conn] = role
	currentState := room.State
	room.mu.Unlock()

	log.Printf("Connected %s to room %s. Total connections in room: %d", role, roomID, len(room.Clients))

	// Send initial state to the newly connected client
	initMsg := WSMessage{
		Type:    "init",
		Payload: currentState,
	}
	initBytes, err := json.Marshal(initMsg)
	if err == nil {
		_ = conn.WriteMessage(websocket.TextMessage, initBytes)
	}

	// Read loop
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error in room %s: %v", roomID, err)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("JSON unmarshal error in room %s: %v", roomID, err)
			continue
		}

		switch msg.Type {
		case "state_update":
			// Only process state updates if sender is admin
			// However, in local dev / cooperative environments, we can allow clients if desired.
			// Let's enforce that if we are strict, or just accept updates to keep it robust.
			room.mu.Lock()
			room.State = msg.Payload
			room.State.RoomID = roomID // ensure room ID is correct
			room.mu.Unlock()

			// Broadcast updated state to all connected clients in the room
			broadcastMsg := WSMessage{
				Type:    "state_update",
				Payload: room.State,
			}
			broadcastBytes, err := json.Marshal(broadcastMsg)
			if err != nil {
				log.Printf("JSON marshal error during broadcast: %v", err)
				continue
			}

			room.mu.Lock()
			for clientConn := range room.Clients {
				// Don't echo back to the same connection that sent it to save bandwidth,
				// but let's broadcast to all other connections.
				if clientConn == conn {
					continue
				}
				go func(c *websocket.Conn, b []byte) {
					// We might need a mutex wrapper per-connection if multiple concurrent writes happen,
					// but Go's HTTP routing & websocket reading are generally separate.
					// Let's protect writes or let them write sequentially.
					_ = c.WriteMessage(websocket.TextMessage, b)
				}(clientConn, broadcastBytes)
			}
			room.mu.Unlock()

		case "ping":
			_ = conn.WriteJSON(WSMessage{Type: "pong"})
		}
	}

	hub.removeConnection(roomID, conn)
}

// Handle file uploads
func handleUpload(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
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

	// Max 20MB files
	r.ParseMultipartForm(20 << 20)

	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, fmt.Sprintf("Error retrieving file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Ensure uploads directory exists
	uploadDir := "./uploads"
	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		http.Error(w, "Failed to create uploads directory", http.StatusInternalServerError)
		return
	}

	// Create unique file name using timestamp
	ext := filepath.Ext(handler.Filename)
	filename := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	filePath := filepath.Join(uploadDir, filename)

	targetFile, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE, 0666)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, file); err != nil {
		http.Error(w, "Failed to write file contents", http.StatusInternalServerError)
		return
	}

	// Return JSON with the relative file URL
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

	// Prepend static path
	path = filepath.Join(h.staticPath, path)

	// Check if file exists
	fi, err := os.Stat(path)
	if os.IsNotExist(err) || fi.IsDir() {
		// Serve index.html instead for SPA router
		http.ServeFile(w, r, filepath.Join(h.staticPath, h.indexPath))
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// File exists, serve static content
	http.FileServer(http.Dir(h.staticPath)).ServeHTTP(w, r)
}

func main() {
	port := flag.Int("port", 8080, "Port to run the backend server on")
	flag.Parse()

	// Ensure uploads directory exists
	if err := os.MkdirAll("./uploads", os.ModePerm); err != nil {
		log.Fatalf("Failed to create uploads directory: %v", err)
	}

	mux := http.NewServeMux()

	// WebSocket handler
	mux.HandleFunc("/ws", handleWebSocket)

	// API Handlers
	mux.HandleFunc("/api/upload", handleUpload)
	mux.HandleFunc("/api/rooms", handleRoomsList)

	// Serve Uploaded Files
	fs := http.FileServer(http.Dir("./uploads"))
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", fs))

	// SPA Static Frontend Files
	// If front-end is compiled into `./dist`, serve it.
	// Check if ./dist exists, otherwise use a placeholder warning or serve what we can.
	distPath := "./dist"
	if _, err := os.Stat(distPath); os.IsNotExist(err) {
		log.Printf("Warning: ./dist directory not found. Please build frontend with 'npm run build'")
	}

	spa := spaHandler{staticPath: distPath, indexPath: "index.html"}
	mux.Handle("/", spa)

	// Add CORS for API endpoints
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Very permissive CORS for local tabletop development and remote debugging
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		}
		if r.Method == "OPTIONS" {
			return
		}
		mux.ServeHTTP(w, r)
	})

	serverAddr := fmt.Sprintf("0.0.0.0:%d", *port)
	log.Printf("Starting TopView server on http://%s", serverAddr)
	if err := http.ListenAndServe(serverAddr, handler); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
