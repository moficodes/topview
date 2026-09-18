# Room Key Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement key-based room protection with auto-generated admin keys and 6-digit client passcodes to prevent unauthorized takeovers and protect participant access.

**Architecture:** 
- Backend: `Room` stores `AdminKey` (crypto-random hex token) and `ClientKey` (6-digit numeric passcode). `POST /api/rooms/create` creates rooms and returns keys. `/ws` enforces constant-time key validation for `role=admin` and `role=client`, rejecting unauthorized handshakes with HTTP 401. Public `/api/rooms` remains key-free.
- Frontend: `Home.tsx` calls room creation API and redirects host with `?key=<adminKey>`. `Admin.tsx` connects using the admin key, displays the client PIN, and generates viewer share URLs with `?key=<clientKey>`. `RoomClient.tsx` seamlessly connects when `?key=...` is in the URL, and displays a tabletop PIN dialog if opened without a key.
- Cloud Deployment: Verified through Go race tests, TypeScript build, and deployed to Cloud Run with 1 always-on instance.

**Tech Stack:** Go 1.22, Gorilla WebSocket, React 19, TypeScript, React Router 7, Tailwind CSS v4, Google Cloud Run.

---

### Task 1: Backend Room Key Generation & Creation API

**Files:**
- Modify: `backend/main.go`
- Test: `backend/main_test.go`

- [ ] **Step 1: Write failing tests for key generation and `POST /api/rooms/create`**

Add tests to `backend/main_test.go`:
1. `TestRoomCreation_Success`: `POST /api/rooms/create` with new `roomId` returns 200, valid `adminKey` (`adm_...`), and 6-digit `clientKey`.
2. `TestRoomCreation_ExistingRoomReclaim`: Call with matching `adminKey` returns 200 and existing keys; call with wrong/missing `adminKey` returns 403 Forbidden.
3. `TestPublicRoomsList_NeverLeaksKeys`: `GET /api/rooms` does not expose `adminKey` or `clientKey`.

- [ ] **Step 2: Run tests to verify failure**

Run: `go test -v -run "TestRoomCreation|TestPublicRoomsList_NeverLeaksKeys" ./...` in `backend/`
Expected: FAIL (endpoint `/api/rooms/create` not found)

- [ ] **Step 3: Implement key storage, generation, and creation endpoint in `backend/main.go`**

1. Update `Room` struct:
   ```go
   type Room struct {
       ID        string
       AdminKey  string
       ClientKey string
       State     RoomState
       Clients   map[*SafeConn]string
       mu        sync.Mutex
   }
   ```
2. Add crypto key generators:
   - `generateAdminKey() string`: `adm_` + 16 random bytes hex-encoded.
   - `generateClientKey() string`: 6-digit decimal string (`100000`–`999999`) using `crypto/rand`.
3. Add handler `handleCreateRoom(w http.ResponseWriter, r *http.Request)`:
   - Method POST only.
   - Parse JSON `{ "roomId": "string", "adminKey": "string" }`.
   - Sanitize `roomId` (alphanumeric, dashes, underscores).
   - If room does not exist: create with new `AdminKey` and `ClientKey`.
   - If room exists: check `subtle.ConstantTimeCompare([]byte(req.AdminKey), []byte(room.AdminKey)) == 1`. If match, return keys; else return 403 Forbidden.
   - Return JSON `{ "roomId": "...", "adminKey": "...", "clientKey": "..." }`.
4. Register route in `main()`: `mux.HandleFunc("/api/rooms/create", handleCreateRoom)`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `go test -v -run "TestRoomCreation|TestPublicRoomsList_NeverLeaksKeys" ./...` in `backend/`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add backend/main.go backend/main_test.go
git commit -m "feat(backend): add room key generation and creation endpoint"
```

---

### Task 2: Backend WebSocket Authorization by Role & Key

**Files:**
- Modify: `backend/main.go`
- Test: `backend/main_test.go`

- [ ] **Step 1: Write failing tests for WebSocket key validation**

Add tests to `backend/main_test.go`:
1. `TestWebSocket_AdminAuth`:
   - Admin without key $\rightarrow$ 401 Unauthorized.
   - Admin with wrong key $\rightarrow$ 401 Unauthorized.
   - Admin with correct key $\rightarrow$ 101 Switching Protocols.
2. `TestWebSocket_ClientAuth`:
   - Client without key $\rightarrow$ 401 Unauthorized.
   - Client with wrong key $\rightarrow$ 401 Unauthorized.
   - Client with correct key $\rightarrow$ 101 Switching Protocols.
3. `TestWebSocket_AdminReceivesClientKeyInInit`:
   - Admin receives `clientKey` in `init` message metadata.

- [ ] **Step 2: Run tests to verify failure**

Run: `go test -v -run "TestWebSocket_AdminAuth|TestWebSocket_ClientAuth|TestWebSocket_AdminReceivesClientKeyInInit" ./...` in `backend/`
Expected: FAIL (WebSocket currently accepts any connection without key)

- [ ] **Step 3: Implement key validation in `handleWebSocket`**

1. In `handleWebSocket`:
   - Retrieve `key := r.URL.Query().Get("key")`.
   - Lookup room from hub. If room does not exist and role is admin: create room; if role is client: return 404 Not Found.
   - For `role == "admin"`:
     - Verify `subtle.ConstantTimeCompare([]byte(key), []byte(room.AdminKey)) == 1`.
     - If false: `http.Error(w, "Invalid admin key", http.StatusUnauthorized); return`.
   - For `role == "client"`:
     - Verify `subtle.ConstantTimeCompare([]byte(key), []byte(room.ClientKey)) == 1`.
     - If false: `http.Error(w, "Invalid client key", http.StatusUnauthorized); return`.
2. In `WSMessage`:
   - Add `ClientKey string json:"clientKey,omitempty"` so when `role == "admin"`, `init` message transmits `clientKey` for host display.

- [ ] **Step 4: Run tests and `go vet`**

Run: `go test -race -v ./... && go vet ./...` in `backend/`
Expected: All tests pass with zero data races.

- [ ] **Step 5: Commit changes**

```bash
git add backend/main.go backend/main_test.go
git commit -m "feat(backend): enforce constant-time key authorization on websocket connections"
```

---

### Task 3: Frontend Home Page & Admin Dashboard Integration

**Files:**
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/pages/Admin.tsx`

- [ ] **Step 1: Update `Home.tsx` room creation flow**

1. In `handleCreateRoom`:
   - Send `POST /api/rooms/create` with `{ "roomId": cleanId }`.
   - On success: navigate to `/admin/${data.roomId}?key=${data.adminKey}`.
   - If 403 Forbidden: display error toast/message ("Room is already claimed by another admin").
2. In `handleJoinRoom`:
   - Navigate to `/room/${id}`.

- [ ] **Step 2: Update `Admin.tsx` authentication & sharing flow**

1. Use `useSearchParams` to read `key` from query string: `searchParams.get("key") || ""`.
2. Store `clientKey` state (`const [clientKey, setClientKey] = useState("")`).
3. Connect WebSocket with `&key=${encodeURIComponent(key)}`.
4. In `ws.onmessage` for `"init"`: if `msg.clientKey`, `setClientKey(msg.clientKey)`.
5. Update `copyClientLink`:
   - Generate link: `${window.location.protocol}//${window.location.host}/room/${roomId}${clientKey ? `?key=${clientKey}` : ""}`.
6. In Admin Header:
   - If `clientKey` is available, render a copyable badge: `PASSCODE: [482195]` with copy button.
7. Error state:
   - If WebSocket connection fails due to invalid key, display an "Unauthorized Admin Key" error card with an input to re-enter key or return to Home.

- [ ] **Step 3: Run frontend lint and build**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit changes**

```bash
git add frontend/src/pages/Home.tsx frontend/src/pages/Admin.tsx
git commit -m "feat(frontend): integrate room creation api and admin key authorization"
```

---

### Task 4: Frontend Client Passcode Entry & PIN Dialog

**Files:**
- Modify: `frontend/src/pages/RoomClient.tsx`

- [ ] **Step 1: Add client key parameter & PIN fallback modal**

1. In `RoomClient.tsx`:
   - Use `useSearchParams` to read `key`: `const urlKey = searchParams.get("key") || ""`.
   - Track `clientKey` state (defaulting to `urlKey`).
   - Track `needsPasscode` state (`boolean`, true if `!urlKey` or if server returns 401).
   - Track `passcodeInput` state for user entry.
2. In `useEffect`:
   - If `!clientKey`: set `needsPasscode(true)` and do not open WebSocket yet.
   - If `clientKey`: connect to `/ws?roomId=${roomId}&role=client&key=${encodeURIComponent(clientKey)}`.
   - On `ws.onerror` / failure: if connection closes before open, check if unauthorized and set `needsPasscode(true)`.
3. In JSX:
   - When `needsPasscode` is true: render an "Enter Room Passcode" dialog:
     - 6-digit monospace input with auto-focus.
     - "Join Room" button.
     - On submit: update `clientKey`, update URL query params (`setSearchParams({ key: passcodeInput })`), and reset `needsPasscode(false)`.

- [ ] **Step 2: Run frontend lint and build**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit changes**

```bash
git add frontend/src/pages/RoomClient.tsx
git commit -m "feat(frontend): add client passcode entry dialog and url key support"
```

---

### Task 5: Comprehensive Verification & Cloud Run Deployment

**Files:**
- All modified files

- [ ] **Step 1: Run backend tests and vet**

Run: `go test -race -v -count=1 ./... && go vet ./...` in `backend/`
Expected: All tests pass, 0 data races.

- [ ] **Step 2: Run frontend lint and build**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Build & Push image v1.4.0**

Run: `gcloud builds submit --tag us-docker.pkg.dev/mofilabs/tabletop/presenter:v1.4.0`
Expected: SUCCESS.

- [ ] **Step 4: Deploy to Cloud Run**

Run:
```bash
gcloud run deploy tabletop-presenter \
  --image=us-docker.pkg.dev/mofilabs/tabletop/presenter:v1.4.0 \
  --region=us-central1 \
  --min-instances=1 \
  --max-instances=1 \
  --timeout=3600 \
  --no-cpu-throttling \
  --session-affinity \
  --allow-unauthenticated \
  --platform=managed
```

- [ ] **Step 5: Verify live service and push git commits**

Run: `curl -sI https://tabletop-presenter-598464211339.us-central1.run.app/`
Run: `git push origin main`
Expected: Service up and git synchronized.
