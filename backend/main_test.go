package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Helper to generate minimal valid PNG bytes
func generatePNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// Helper to generate minimal valid JPEG bytes
func generateJPEG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{B: 255, A: 255})
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

// Helper to generate minimal valid WebP bytes
func generateWebP() []byte {
	// RIFF (4) + length (4) + WEBP (4) + VP8 (4) + header data
	data := []byte("RIFF\x14\x00\x00\x00WEBPVP8 \x08\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00")
	return data
}

// Helper to build a multipart request
func buildMultipartRequest(t *testing.T, fieldName, filename string, content []byte) *http.Request {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	if fieldName != "" {
		part, err := writer.CreateFormFile(fieldName, filename)
		if err != nil {
			t.Fatalf("failed to create form file: %v", err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatalf("failed to write content to part: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestHandleUpload_Validation(t *testing.T) {
	origUploadDir := uploadDir
	uploadDir = t.TempDir()
	t.Cleanup(func() {
		uploadDir = origUploadDir
	})

	t.Run("RejectsEmptyRequest", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/upload", nil)
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status %d for empty request, got %d", http.StatusBadRequest, rec.Code)
		}
	})

	t.Run("RejectsMissingImageField", func(t *testing.T) {
		req := buildMultipartRequest(t, "document", "file.png", generatePNG())
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status %d for missing image field, got %d", http.StatusBadRequest, rec.Code)
		}
	})

	t.Run("RejectsDisallowedExtensions", func(t *testing.T) {
		badExtensions := []string{"test.txt", "script.sh", "malware.exe", "doc.pdf", "archive.zip"}
		for _, filename := range badExtensions {
			req := buildMultipartRequest(t, "image", filename, []byte("some arbitrary text content"))
			rec := httptest.NewRecorder()

			handleUpload(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("expected status %d for filename %q, got %d", http.StatusBadRequest, filename, rec.Code)
			}
		}
	})

	t.Run("RejectsEmptyFile", func(t *testing.T) {
		req := buildMultipartRequest(t, "image", "empty.png", []byte{})
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status %d for empty file, got %d", http.StatusBadRequest, rec.Code)
		}
	})

	t.Run("RejectsMismatchedMIMEType", func(t *testing.T) {
		// Named .png or .jpg but containing plain text
		req := buildMultipartRequest(t, "image", "fake.png", []byte("This is definitely plain text, not a PNG!"))
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status %d for fake png content, got %d", http.StatusBadRequest, rec.Code)
		}
	})

	t.Run("RejectsOversizedUpload", func(t *testing.T) {
		// Send request exceeding 20MB using a streaming pipe
		pr, pw := io.Pipe()
		defer pr.Close()
		writer := multipart.NewWriter(pw)

		go func() {
			part, err := writer.CreateFormFile("image", "large.png")
			if err != nil {
				pw.CloseWithError(err)
				return
			}
			// Write 21MB in chunks
			chunk := make([]byte, 64*1024)
			var total int64
			limit := int64(21 << 20)
			for total < limit {
				n, err := part.Write(chunk)
				if err != nil {
					pw.CloseWithError(err)
					return
				}
				total += int64(n)
			}
			writer.Close()
			pw.Close()
		}()

		req := httptest.NewRequest(http.MethodPost, "/api/upload", pr)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status %d for upload >20MB, got %d", http.StatusBadRequest, rec.Code)
		}
	})

	t.Run("AcceptsValidPNG", func(t *testing.T) {
		pngBytes := generatePNG()
		req := buildMultipartRequest(t, "image", "valid.png", pngBytes)
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status %d for valid PNG, got %d", http.StatusOK, rec.Code)
		}

		var resp map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode JSON response: %v", err)
		}
		if !strings.HasPrefix(resp["url"], "/uploads/") || !strings.HasSuffix(resp["url"], ".png") {
			t.Errorf("unexpected upload url: %s", resp["url"])
		}
	})

	t.Run("AcceptsValidJPEG", func(t *testing.T) {
		jpegBytes := generateJPEG()
		req := buildMultipartRequest(t, "image", "valid.jpg", jpegBytes)
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status %d for valid JPEG, got %d", http.StatusOK, rec.Code)
		}

		var resp map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode JSON response: %v", err)
		}
		if !strings.HasPrefix(resp["url"], "/uploads/") || !strings.HasSuffix(resp["url"], ".jpg") {
			t.Errorf("unexpected upload url: %s", resp["url"])
		}
	})

	t.Run("AcceptsValidWebP", func(t *testing.T) {
		webpBytes := generateWebP()
		req := buildMultipartRequest(t, "image", "valid.webp", webpBytes)
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status %d for valid WebP, got %d", http.StatusOK, rec.Code)
		}

		var resp map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode JSON response: %v", err)
		}
		if !strings.HasPrefix(resp["url"], "/uploads/") || !strings.HasSuffix(resp["url"], ".webp") {
			t.Errorf("unexpected upload url: %s", resp["url"])
		}
	})

	t.Run("AcceptsCaseInsensitiveExtension", func(t *testing.T) {
		jpegBytes := generateJPEG()
		req := buildMultipartRequest(t, "image", "VALID.JPEG", jpegBytes)
		rec := httptest.NewRecorder()

		handleUpload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status %d for VALID.JPEG, got %d", http.StatusOK, rec.Code)
		}
	})
}

func TestRoomState_Validation(t *testing.T) {
	t.Run("ScaleNaNAndInf", func(t *testing.T) {
		nanState := RoomState{Scale: math.NaN()}
		validateRoomState(&nanState)
		if math.IsNaN(nanState.Scale) || nanState.Scale != 1.0 {
			t.Errorf("expected NaN scale to become 1.0, got %v", nanState.Scale)
		}

		posInfState := RoomState{Scale: math.Inf(1)}
		validateRoomState(&posInfState)
		if math.IsInf(posInfState.Scale, 1) || posInfState.Scale != 1.0 {
			t.Errorf("expected +Inf scale to become 1.0, got %v", posInfState.Scale)
		}

		negInfState := RoomState{Scale: math.Inf(-1)}
		validateRoomState(&negInfState)
		if math.IsInf(negInfState.Scale, -1) || negInfState.Scale != 1.0 {
			t.Errorf("expected -Inf scale to become 1.0, got %v", negInfState.Scale)
		}
	})

	t.Run("ScaleClamping", func(t *testing.T) {
		tooSmall := RoomState{Scale: 0.05}
		validateRoomState(&tooSmall)
		if tooSmall.Scale != 0.1 {
			t.Errorf("expected scale 0.05 to clamp to 0.1, got %v", tooSmall.Scale)
		}

		negative := RoomState{Scale: -1.0}
		validateRoomState(&negative)
		if negative.Scale != 0.1 {
			t.Errorf("expected negative scale to clamp to 0.1, got %v", negative.Scale)
		}

		tooBig := RoomState{Scale: 20.0}
		validateRoomState(&tooBig)
		if tooBig.Scale != 15.0 {
			t.Errorf("expected scale 20.0 to clamp to 15.0, got %v", tooBig.Scale)
		}

		valid := RoomState{Scale: 5.5}
		validateRoomState(&valid)
		if valid.Scale != 5.5 {
			t.Errorf("expected valid scale 5.5 to remain unchanged, got %v", valid.Scale)
		}
	})

	t.Run("LayoutValidation", func(t *testing.T) {
		validLayouts := []string{"1", "2-tb", "2-lr", "3-trb", "3-tlb", "4"}
		for _, l := range validLayouts {
			s := RoomState{Layout: l}
			validateRoomState(&s)
			if s.Layout != l {
				t.Errorf("expected valid layout %q to be preserved, got %q", l, s.Layout)
			}
		}

		invalidLayouts := []string{"", "0", "5", "custom", "unknown"}
		for _, l := range invalidLayouts {
			s := RoomState{Layout: l}
			validateRoomState(&s)
			if s.Layout != "1" {
				t.Errorf("expected invalid layout %q to default to '1', got %q", l, s.Layout)
			}
		}
	})

	t.Run("AspectRatioValidation", func(t *testing.T) {
		validAspectRatios := []string{"16:9", "16:10", "4:3", "1:1", "21:9"}
		for _, ar := range validAspectRatios {
			s := RoomState{AspectRatio: ar}
			validateRoomState(&s)
			if s.AspectRatio != ar {
				t.Errorf("expected valid aspectRatio %q to be preserved, got %q", ar, s.AspectRatio)
			}
		}

		invalidAspectRatios := []string{"", "3:2", "custom", "16:8"}
		for _, ar := range invalidAspectRatios {
			s := RoomState{AspectRatio: ar}
			validateRoomState(&s)
			if s.AspectRatio != "16:9" {
				t.Errorf("expected invalid aspectRatio %q to default to '16:9', got %q", ar, s.AspectRatio)
			}
		}
	})
}

func createTestRoom(t *testing.T, roomID string) (string, string) {
	t.Helper()
	createBody := fmt.Sprintf(`{"roomId": %q}`, roomID)
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleCreateRoom(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("createTestRoom failed for room %s: %d %s", roomID, rec.Code, rec.Body.String())
	}
	var resp struct {
		RoomID    string `json:"roomId"`
		AdminKey  string `json:"adminKey"`
		ClientKey string `json:"clientKey"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("createTestRoom json decode failed: %v", err)
	}
	return resp.AdminKey, resp.ClientKey
}

func TestWebSocket_AdminAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(handleWebSocket))
	defer server.Close()

	wsBaseURL := "ws" + strings.TrimPrefix(server.URL, "http")
	roomID := fmt.Sprintf("test-admin-auth-%d", time.Now().UnixNano())
	adminKey, _ := createTestRoom(t, roomID)
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	t.Run("NonExistentRoom", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=non-existent-room-admin&role=admin&key=adm_123", wsBaseURL)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatal("expected error connecting to non-existent room, got nil")
		}
		if resp == nil || resp.StatusCode != http.StatusNotFound {
			t.Fatalf("expected status 404 Not Found, got %v", resp)
		}
	})

	t.Run("NoKey", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=admin", wsBaseURL, roomID)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatal("expected error connecting without key, got nil")
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected status 401 Unauthorized, got %v", resp)
		}
	})

	t.Run("WrongKey", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=admin&key=wrong-key", wsBaseURL, roomID)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatal("expected error connecting with wrong key, got nil")
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected status 401 Unauthorized, got %v", resp)
		}
	})

	t.Run("CorrectKey", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=admin&key=%s", wsBaseURL, roomID, adminKey)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatalf("expected successful connection with correct key, got err: %v", err)
		}
		defer conn.Close()
		if resp == nil || resp.StatusCode != http.StatusSwitchingProtocols {
			t.Fatalf("expected status 101 Switching Protocols, got %v", resp)
		}
	})
}

func TestWebSocket_ClientAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(handleWebSocket))
	defer server.Close()

	wsBaseURL := "ws" + strings.TrimPrefix(server.URL, "http")
	roomID := fmt.Sprintf("test-client-auth-%d", time.Now().UnixNano())
	_, clientKey := createTestRoom(t, roomID)
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	t.Run("NoKey", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=client", wsBaseURL, roomID)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatal("expected error connecting without key, got nil")
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected status 401 Unauthorized, got %v", resp)
		}
	})

	t.Run("WrongKey", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=000000", wsBaseURL, roomID)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatal("expected error connecting with wrong key, got nil")
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected status 401 Unauthorized, got %v", resp)
		}
	})

	t.Run("NonExistentRoom", func(t *testing.T) {
		nonExistentRoomID := fmt.Sprintf("non-existent-%d", time.Now().UnixNano())
		url := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=%s", wsBaseURL, nonExistentRoomID, clientKey)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatal("expected error connecting to non-existent room, got nil")
		}
		if resp == nil || resp.StatusCode != http.StatusNotFound {
			t.Fatalf("expected status 404 Not Found, got %v", resp)
		}
	})

	t.Run("CorrectKey", func(t *testing.T) {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=%s", wsBaseURL, roomID, clientKey)
		conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatalf("expected successful connection with correct key, got err: %v", err)
		}
		defer conn.Close()
		if resp == nil || resp.StatusCode != http.StatusSwitchingProtocols {
			t.Fatalf("expected status 101 Switching Protocols, got %v", resp)
		}
	})
}

func TestWebSocket_AdminReceivesClientKeyInInit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(handleWebSocket))
	defer server.Close()

	wsBaseURL := "ws" + strings.TrimPrefix(server.URL, "http")
	roomID := fmt.Sprintf("test-admin-clientkey-%d", time.Now().UnixNano())
	adminKey, expectedClientKey := createTestRoom(t, roomID)
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	url := fmt.Sprintf("%s/ws?roomId=%s&role=admin&key=%s", wsBaseURL, roomID, adminKey)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("failed to connect admin: %v", err)
	}
	defer conn.Close()

	var initMsg struct {
		Type      string    `json:"type"`
		Payload   RoomState `json:"payload"`
		ClientKey string    `json:"clientKey"`
	}
	if err := conn.ReadJSON(&initMsg); err != nil {
		t.Fatalf("failed to read init message: %v", err)
	}
	if initMsg.Type != "init" {
		t.Fatalf("expected init msg type 'init', got %q", initMsg.Type)
	}
	if initMsg.ClientKey != expectedClientKey {
		t.Fatalf("expected initMsg.ClientKey to be %q, got %q", expectedClientKey, initMsg.ClientKey)
	}
	matched, err := regexp.MatchString(`^[0-9]{6}$`, initMsg.ClientKey)
	if err != nil || !matched {
		t.Fatalf("expected initMsg.ClientKey to be 6 digits, got %q", initMsg.ClientKey)
	}
}

func TestWebSocket_RoleAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(handleWebSocket))
	defer server.Close()

	roomID := fmt.Sprintf("test-room-auth-%d", time.Now().UnixNano())
	adminKey, clientKey := createTestRoom(t, roomID)
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})
	wsBaseURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Connect Admin
	adminURL := fmt.Sprintf("%s/ws?roomId=%s&role=admin&key=%s", wsBaseURL, roomID, adminKey)
	adminConn, _, err := websocket.DefaultDialer.Dial(adminURL, nil)
	if err != nil {
		t.Fatalf("failed to connect admin: %v", err)
	}
	defer adminConn.Close()

	// Read admin's initial state
	var adminInit WSMessage
	if err := adminConn.ReadJSON(&adminInit); err != nil {
		t.Fatalf("failed to read admin init: %v", err)
	}
	if adminInit.Type != "init" {
		t.Fatalf("expected admin init type 'init', got %q", adminInit.Type)
	}

	// Connect Client
	clientURL := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=%s", wsBaseURL, roomID, clientKey)
	clientConn, _, err := websocket.DefaultDialer.Dial(clientURL, nil)
	if err != nil {
		t.Fatalf("failed to connect client: %v", err)
	}
	defer clientConn.Close()

	// Read client's initial state
	var clientInit WSMessage
	if err := clientConn.ReadJSON(&clientInit); err != nil {
		t.Fatalf("failed to read client init: %v", err)
	}
	if clientInit.Type != "init" {
		t.Fatalf("expected client init type 'init', got %q", clientInit.Type)
	}

	// Attempt 1: Client tries to send state_update -> MUST BE REJECTED
	clientUnauthorizedUpdate := WSMessage{
		Type: "state_update",
		Payload: RoomState{
			RoomID: roomID,
			Scale:  4.5,
			Layout: "4",
		},
	}
	if err := clientConn.WriteJSON(clientUnauthorizedUpdate); err != nil {
		t.Fatalf("failed to send client update: %v", err)
	}

	// Admin should NOT receive any broadcast
	_ = adminConn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
	var unauthBroadcast WSMessage
	err = adminConn.ReadJSON(&unauthBroadcast)
	if err == nil {
		t.Fatalf("expected no broadcast to admin for client state_update, but received: %+v", unauthBroadcast)
	}

	// Verify room state was NOT changed
	hub.mu.RLock()
	room := hub.rooms[roomID]
	hub.mu.RUnlock()
	if room != nil {
		room.mu.Lock()
		if room.State.Scale == 4.5 {
			room.mu.Unlock()
			t.Fatalf("room state was modified by unauthorized client update")
		}
		room.mu.Unlock()
	}

	// Attempt 2: Admin sends state_update -> MUST BE ACCEPTED AND BROADCAST
	adminAuthorizedUpdate := WSMessage{
		Type: "state_update",
		Payload: RoomState{
			RoomID:      roomID,
			Scale:       2.5,
			Layout:      "2-tb",
			AspectRatio: "16:9",
		},
	}
	if err := adminConn.WriteJSON(adminAuthorizedUpdate); err != nil {
		t.Fatalf("failed to send admin update: %v", err)
	}

	// Client should receive the broadcast
	_ = clientConn.SetReadDeadline(time.Now().Add(1 * time.Second))
	var authBroadcast WSMessage
	if err := clientConn.ReadJSON(&authBroadcast); err != nil {
		t.Fatalf("expected client to receive admin broadcast, got err: %v", err)
	}
	if authBroadcast.Type != "state_update" {
		t.Errorf("expected broadcast type 'state_update', got %q", authBroadcast.Type)
	}
	if authBroadcast.Payload.Scale != 2.5 || authBroadcast.Payload.Layout != "2-tb" {
		t.Errorf("unexpected broadcast payload: %+v", authBroadcast.Payload)
	}
}

func TestSpaHandler(t *testing.T) {
	tempDir := t.TempDir()

	// Write static files
	indexContent := "<html><body>Index Fallback</body></html>"
	if err := os.WriteFile(filepath.Join(tempDir, "index.html"), []byte(indexContent), 0644); err != nil {
		t.Fatalf("failed to write index.html: %v", err)
	}

	assetContent := "body { color: red; }"
	if err := os.WriteFile(filepath.Join(tempDir, "style.css"), []byte(assetContent), 0644); err != nil {
		t.Fatalf("failed to write style.css: %v", err)
	}

	handler := spaHandler{
		staticPath: tempDir,
		indexPath:  "index.html",
	}

	t.Run("ServesExistingStaticFile", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/style.css", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "color: red") {
			t.Errorf("expected body to contain CSS content, got %q", rec.Body.String())
		}
	})

	t.Run("ServesIndexFallbackOnNonExistentPath", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/room/abc-123", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "Index Fallback") {
			t.Errorf("expected body to contain index fallback, got %q", rec.Body.String())
		}
	})

	t.Run("ServesIndexFallbackOnDirectory", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "Index Fallback") {
			t.Errorf("expected body to contain index fallback, got %q", rec.Body.String())
		}
	})

	t.Run("StatErrorHandling_NoPanicOnNonNotExistError", func(t *testing.T) {
		// Create a restricted directory with mode 0000 to trigger EACCES (permission denied)
		restrictedDir := filepath.Join(tempDir, "restricted")
		if err := os.Mkdir(restrictedDir, 0755); err != nil {
			t.Fatalf("failed to create restricted dir: %v", err)
		}
		secretFile := filepath.Join(restrictedDir, "secret.txt")
		if err := os.WriteFile(secretFile, []byte("secret"), 0644); err != nil {
			t.Fatalf("failed to write secret file: %v", err)
		}

		if err := os.Chmod(restrictedDir, 0000); err != nil {
			t.Fatalf("failed to chmod restricted dir: %v", err)
		}
		defer os.Chmod(restrictedDir, 0755)

		req := httptest.NewRequest(http.MethodGet, "/restricted/secret.txt", nil)
		rec := httptest.NewRecorder()

		// Protect against unhandled panics (the bug being tested)
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("spaHandler panicked on non-NotExist os.Stat error: %v", r)
			}
		}()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Errorf("expected status %d for unreadable file, got %d", http.StatusInternalServerError, rec.Code)
		}
	})
}

func TestSecurityHeaders(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	middleware := setupMiddleware(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/rooms", nil)
	rec := httptest.NewRecorder()

	middleware.ServeHTTP(rec, req)

	if val := rec.Header().Get("X-Content-Type-Options"); val != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", val)
	}
	if val := rec.Header().Get("X-Frame-Options"); val != "SAMEORIGIN" {
		t.Errorf("expected X-Frame-Options: SAMEORIGIN, got %q", val)
	}
}

func TestConcurrentBroadcast(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(handleWebSocket))
	defer server.Close()

	wsBaseURL := "ws" + strings.TrimPrefix(server.URL, "http")
	roomID := fmt.Sprintf("test-room-bcast-%d", time.Now().UnixNano())
	adminKey, clientKey := createTestRoom(t, roomID)
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	// Baseline goroutine count before dialing connections
	baselineGoroutines := runtime.NumGoroutine()

	// Connect Admin
	adminURL := fmt.Sprintf("%s/ws?roomId=%s&role=admin&key=%s", wsBaseURL, roomID, adminKey)
	adminConn, _, err := websocket.DefaultDialer.Dial(adminURL, nil)
	if err != nil {
		t.Fatalf("failed to connect admin: %v", err)
	}
	defer adminConn.Close()

	var adminInit WSMessage
	if err := adminConn.ReadJSON(&adminInit); err != nil {
		t.Fatalf("failed to read admin init: %v", err)
	}

	// Connect 5 clients
	const numClients = 5
	const numUpdates = 50

	clients := make([]*websocket.Conn, numClients)
	for i := 0; i < numClients; i++ {
		clientURL := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=%s", wsBaseURL, roomID, clientKey)
		conn, _, err := websocket.DefaultDialer.Dial(clientURL, nil)
		if err != nil {
			t.Fatalf("client %d failed to connect: %v", i, err)
		}
		defer conn.Close()

		var clientInit WSMessage
		if err := conn.ReadJSON(&clientInit); err != nil {
			t.Fatalf("client %d failed to read init: %v", i, err)
		}
		clients[i] = conn
	}

	var wg sync.WaitGroup
	receivedCounts := make([]int, numClients)
	lastReceivedX := make([]float64, numClients)
	var countMu sync.Mutex

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(id int, conn *websocket.Conn) {
			defer wg.Done()
			for {
				_ = conn.SetReadDeadline(time.Now().Add(4 * time.Second))
				var msg WSMessage
				err := conn.ReadJSON(&msg)
				if err != nil {
					return
				}
				if msg.Type == "state_update" {
					countMu.Lock()
					receivedCounts[id]++
					lastReceivedX[id] = msg.Payload.X
					reachedTarget := (msg.Payload.X == float64(numUpdates))
					countMu.Unlock()
					if reachedTarget {
						return
					}
				}
			}
		}(i, clients[i])
	}

	// Rapidly fire 50 state updates from admin
	for i := 1; i <= numUpdates; i++ {
		update := WSMessage{
			Type: "state_update",
			Payload: RoomState{
				RoomID:      roomID,
				X:           float64(i),
				Scale:       1.0,
				Layout:      "1",
				AspectRatio: "16:9",
			},
		}
		if err := adminConn.WriteJSON(update); err != nil {
			t.Fatalf("failed to send update %d: %v", i, err)
		}
	}

	// Wait for clients to finish receiving updates
	doneCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneCh)
	}()

	select {
	case <-doneCh:
		// Completed within timeout
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for clients to receive updates (hang or deadlocked)")
	}

	countMu.Lock()
	for i := 0; i < numClients; i++ {
		if receivedCounts[i] == 0 {
			t.Errorf("client %d received 0 updates", i)
		}
		if lastReceivedX[i] != float64(numUpdates) {
			t.Errorf("client %d last X was %v, expected %v", i, lastReceivedX[i], float64(numUpdates))
		}
	}
	countMu.Unlock()

	// Close all connections to verify clean shutdown without goroutine leak
	_ = adminConn.Close()
	for _, c := range clients {
		_ = c.Close()
	}

	// Allow disconnect cleanup
	time.Sleep(250 * time.Millisecond)

	finalGoroutines := runtime.NumGoroutine()
	// Goroutines should return to baseline (allowing small delta for runtime gc/sysmon)
	if finalGoroutines > baselineGoroutines+5 {
		t.Errorf("possible goroutine leak: baseline %d, final %d", baselineGoroutines, finalGoroutines)
	}
}

func TestRoomPruningRace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(handleWebSocket))
	defer server.Close()

	wsBaseURL := "ws" + strings.TrimPrefix(server.URL, "http")
	roomID := fmt.Sprintf("test-room-prune-%d", time.Now().UnixNano())
	adminKey, clientKey := createTestRoom(t, roomID)
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	const numFlapping = 30
	const numPersistent = 10

	var wg sync.WaitGroup
	persistentConns := make([]*websocket.Conn, numPersistent)

	// Connect persistent clients first to keep room alive
	for i := 0; i < numPersistent; i++ {
		url := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=%s", wsBaseURL, roomID, clientKey)
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatalf("persistent client %d dial failed: %v", i, err)
		}
		var initMsg WSMessage
		if err := conn.ReadJSON(&initMsg); err != nil {
			t.Fatalf("persistent client %d read init failed: %v", i, err)
		}
		persistentConns[i] = conn
	}

	// Concurrently run flapping clients
	for i := 0; i < numFlapping; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			url := fmt.Sprintf("%s/ws?roomId=%s&role=client&key=%s", wsBaseURL, roomID, clientKey)
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				t.Errorf("flapping client %d dial failed: %v", id, err)
				return
			}
			var initMsg WSMessage
			_ = conn.ReadJSON(&initMsg)
			time.Sleep(time.Duration(id%5) * time.Millisecond)
			_ = conn.Close()
		}(i)
	}

	wg.Wait()

	// Wait for server to finish processing all flapping disconnections
	var room *Room
	var exists bool
	var activeCount int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		hub.mu.RLock()
		room, exists = hub.rooms[roomID]
		hub.mu.RUnlock()
		if exists {
			room.mu.Lock()
			activeCount = len(room.Clients)
			room.mu.Unlock()
			if activeCount == numPersistent {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !exists {
		t.Fatalf("expected room %s to exist in hub, but it was incorrectly pruned!", roomID)
	}

	if activeCount != numPersistent {
		t.Errorf("expected %d active clients in room, got %d (clients were orphaned)", numPersistent, activeCount)
	}

	// Connect admin and broadcast an update; all persistent clients must receive it
	adminURL := fmt.Sprintf("%s/ws?roomId=%s&role=admin&key=%s", wsBaseURL, roomID, adminKey)
	adminConn, _, err := websocket.DefaultDialer.Dial(adminURL, nil)
	if err != nil {
		t.Fatalf("admin dial failed: %v", err)
	}
	defer adminConn.Close()

	var adminInit WSMessage
	_ = adminConn.ReadJSON(&adminInit)

	updateMsg := WSMessage{
		Type: "state_update",
		Payload: RoomState{
			RoomID: roomID,
			Scale:  3.14,
			Layout: "2-tb",
		},
	}
	if err := adminConn.WriteJSON(updateMsg); err != nil {
		t.Fatalf("admin write update failed: %v", err)
	}

	for i, conn := range persistentConns {
		if conn == nil {
			continue
		}
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			t.Errorf("persistent client %d failed to receive broadcast: %v (likely orphaned)", i, err)
		} else if msg.Payload.Scale != 3.14 {
			t.Errorf("persistent client %d received unexpected scale: %v", i, msg.Payload.Scale)
		}
		_ = conn.Close()
	}
	_ = adminConn.Close()

	// Poll until room is pruned after all persistent clients and admin disconnected
	deadline = time.Now().Add(3 * time.Second)
	stillExists := true
	for time.Now().Before(deadline) {
		hub.mu.RLock()
		_, stillExists = hub.rooms[roomID]
		hub.mu.RUnlock()
		if !stillExists {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if stillExists {
		t.Errorf("expected room %s to be pruned after all clients disconnected, but still exists in hub", roomID)
	}
}

func TestRoomCreation_Success(t *testing.T) {
	roomID := "test-room-create"
	hub.mu.Lock()
	delete(hub.rooms, roomID)
	hub.mu.Unlock()
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	body := `{"roomId": "test-room-create"}`
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleCreateRoom(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		RoomID    string `json:"roomId"`
		AdminKey  string `json:"adminKey"`
		ClientKey string `json:"clientKey"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if resp.RoomID != roomID {
		t.Errorf("expected roomId %q, got %q", roomID, resp.RoomID)
	}

	if !strings.HasPrefix(resp.AdminKey, "adm_") || len(resp.AdminKey) < 20 {
		t.Errorf("expected adminKey to start with 'adm_' and have length >= 20, got %q (len %d)", resp.AdminKey, len(resp.AdminKey))
	}

	matched, err := regexp.MatchString(`^[0-9]{6}$`, resp.ClientKey)
	if err != nil || !matched {
		t.Errorf("expected clientKey to be exactly 6 digits, got %q", resp.ClientKey)
	}
}

func TestRoomCreation_ExistingRoomReclaim(t *testing.T) {
	roomID := "test-room-reclaim"
	hub.mu.Lock()
	delete(hub.rooms, roomID)
	hub.mu.Unlock()
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	// 1. Create room first
	createBody := fmt.Sprintf(`{"roomId": %q}`, roomID)
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleCreateRoom(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("initial creation failed with status %d: %s", rec.Code, rec.Body.String())
	}

	var initialResp struct {
		RoomID    string `json:"roomId"`
		AdminKey  string `json:"adminKey"`
		ClientKey string `json:"clientKey"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&initialResp); err != nil {
		t.Fatalf("failed to decode initial creation response: %v", err)
	}

	// 2. Send POST /api/rooms/create with same roomId and matching adminKey
	reclaimBody := fmt.Sprintf(`{"roomId": %q, "adminKey": %q}`, roomID, initialResp.AdminKey)
	req = httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(reclaimBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handleCreateRoom(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on matching adminKey reclaim, got %d: %s", rec.Code, rec.Body.String())
	}

	var reclaimResp struct {
		RoomID    string `json:"roomId"`
		AdminKey  string `json:"adminKey"`
		ClientKey string `json:"clientKey"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&reclaimResp); err != nil {
		t.Fatalf("failed to decode reclaim response: %v", err)
	}
	if reclaimResp.AdminKey != initialResp.AdminKey {
		t.Errorf("expected same adminKey %q, got %q", initialResp.AdminKey, reclaimResp.AdminKey)
	}
	if reclaimResp.ClientKey != initialResp.ClientKey {
		t.Errorf("expected same clientKey %q, got %q", initialResp.ClientKey, reclaimResp.ClientKey)
	}

	// 3. Send POST /api/rooms/create with same roomId and wrong adminKey
	wrongKeyBody := fmt.Sprintf(`{"roomId": %q, "adminKey": %q}`, roomID, "adm_wrongkey1234567890")
	req = httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(wrongKeyBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handleCreateRoom(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden on wrong adminKey, got %d", rec.Code)
	}

	// 4. Send POST /api/rooms/create with same roomId and empty adminKey
	emptyKeyBody := fmt.Sprintf(`{"roomId": %q, "adminKey": ""}`, roomID)
	req = httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(emptyKeyBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handleCreateRoom(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden on empty adminKey, got %d", rec.Code)
	}
}

func TestPublicRoomsList_NeverLeaksKeys(t *testing.T) {
	roomID := "test-room-leak-check"
	hub.mu.Lock()
	delete(hub.rooms, roomID)
	hub.mu.Unlock()
	t.Cleanup(func() {
		hub.mu.Lock()
		delete(hub.rooms, roomID)
		hub.mu.Unlock()
	})

	// Create a room first
	createBody := fmt.Sprintf(`{"roomId": %q}`, roomID)
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/create", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleCreateRoom(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("failed to create room for leak check: %d: %s", rec.Code, rec.Body.String())
	}

	var created struct {
		RoomID    string `json:"roomId"`
		AdminKey  string `json:"adminKey"`
		ClientKey string `json:"clientKey"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode created room response: %v", err)
	}

	// Call GET /api/rooms
	listReq := httptest.NewRequest(http.MethodGet, "/api/rooms", nil)
	listRec := httptest.NewRecorder()
	handleRoomsList(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 from /api/rooms, got %d", listRec.Code)
	}

	bodyBytes := listRec.Body.Bytes()
	bodyStr := string(bodyBytes)

	if strings.Contains(bodyStr, "adminKey") {
		t.Errorf("GET /api/rooms response leaked 'adminKey' key: %s", bodyStr)
	}
	if strings.Contains(bodyStr, "clientKey") {
		t.Errorf("GET /api/rooms response leaked 'clientKey' key: %s", bodyStr)
	}
	if created.AdminKey != "" && strings.Contains(bodyStr, created.AdminKey) {
		t.Errorf("GET /api/rooms response leaked actual adminKey value %q", created.AdminKey)
	}
	if created.ClientKey != "" && strings.Contains(bodyStr, created.ClientKey) {
		t.Errorf("GET /api/rooms response leaked actual clientKey value %q", created.ClientKey)
	}
}
