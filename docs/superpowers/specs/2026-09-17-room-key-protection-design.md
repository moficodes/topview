# Room Key Protection Design (Admin Key & Client Passcode)

## Goal
Implement a lightweight key-based protection system for TopView rooms:
1. Prevent unauthorized viewer takeovers of admin presentation controls.
2. Require a client passcode to join a presentation room (via link query param or direct PIN entry).
3. Keep the experience friction-free for tabletop participants without requiring full accounts or passwords.

## Architecture & State Model

### 1. Backend Room Keys (`backend/main.go`)

Each room stores two keys generated upon room creation:
```go
type Room struct {
    ID        string
    AdminKey  string               // Cryptographically secure token (e.g., "adm_7f8a9b2c...")
    ClientKey string               // 6-digit numeric passcode (e.g., "482195")
    State     RoomState
    Clients   map[*SafeConn]string // SafeConn -> role ("admin" or "client")
    mu        sync.Mutex
}
```

Key Generation:
- `AdminKey`: 16 random bytes hex-encoded via `crypto/rand` with prefix `adm_`.
- `ClientKey`: 6-digit numeric string generated via `crypto/rand` (100000–999999).

### 2. Room Creation API (`POST /api/rooms/create`)

Request Body:
```json
{
  "roomId": "table-alpha-101"
}
```

Behavior:
- Sanitizes `roomId` (alphanumeric, dashes, underscores).
- If room does not exist: creates room, generates `AdminKey` and `ClientKey`, and saves into `hub.rooms`.
- If room already exists:
  - If request provides matching `adminKey`, returns existing keys.
  - If room exists and caller does not provide matching `adminKey`, returns `403 Forbidden` ("Room already claimed").
- Response:
```json
{
  "roomId": "table-alpha-101",
  "adminKey": "adm_8f1b2c3d...",
  "clientKey": "482195"
}
```

### 3. Public Room Directory (`GET /api/rooms`)
Returns public room status without exposing keys:
```json
[
  {
    "id": "table-alpha-101",
    "layout": "4",
    "imgUrl": "/uploads/...",
    "clientCount": 4
  }
]
```
`AdminKey` and `ClientKey` are never returned in public listings.

### 4. WebSocket Authorization (`/ws`)

Connection URL format:
`/ws?roomId=<id>&role=<role>&key=<key>`

Validation Rules:
- If `role == "admin"`:
  - Must supply `key`.
  - Evaluated using `subtle.ConstantTimeCompare([]byte(key), []byte(room.AdminKey)) == 1`.
  - If mismatch or missing: HTTP 401 Unauthorized (`"Invalid admin key"`).
- If `role == "client"`:
  - Must supply `key`.
  - Evaluated using `subtle.ConstantTimeCompare([]byte(key), []byte(room.ClientKey)) == 1`.
  - If mismatch or missing: HTTP 401 Unauthorized (`"Invalid client key"`).
- Initial State Message:
  - When an admin connects, the server includes `clientKey` in the `init` payload (or a dedicated field) so the admin dashboard can display the client PIN for tabletop participants.

---

## Frontend Workflows

### 1. Home Page (`Home.tsx`)
- Creating/Entering as Admin:
  - Clicking "Admin Controls" calls `POST /api/rooms/create`.
  - On success, redirects to `/admin/${roomId}?key=${adminKey}`.
  - If the room exists and is claimed by another admin, displays an error message ("Room is already claimed by another admin").
- Joining as Viewer:
  - Clicking "Join Viewer" redirects to `/room/${roomId}`.

### 2. Admin Host Panel (`Admin.tsx`)
- Reads `key` from URL search params (`?key=...`).
- Passes `key` to WebSocket connection URL.
- If WebSocket fails with 401 Unauthorized:
  - Displays an "Unauthorized Admin Key" error card with an input to re-enter the key or return Home.
- "Share Room URL" button:
  - Copies `${window.location.origin}/room/${roomId}?key=${clientKey}`.
- Header PIN Indicator:
  - Displays a pill badge: `PASSCODE: 482195` with a one-click copy button, allowing the host to tell participants the PIN verbally or display it on a whiteboard.

### 3. Client View (`RoomClient.tsx`)
- Reads `?key=...` from URL search params.
- If `key` is present:
  - Connects to `/ws?roomId=${roomId}&role=client&key=${key}`.
- If `key` is absent or connection is rejected with 401 Unauthorized:
  - Displays a clean, tabletop-friendly "Enter Room Passcode" PIN dialog.
  - User enters the 6-digit PIN and clicks "Join Room".
  - The component connects with the entered PIN and updates the browser URL (without reload).

---

## Security & Concurrency Considerations
- **Timing Attacks**: Comparison uses `subtle.ConstantTimeCompare`.
- **Brute Force Protection**: Failed attempts log warnings and enforce standard WebSocket connection closure.
- **Session Cleanup**: When all connections leave a room, the room and its keys are pruned cleanly per existing `Hub.removeConnection` logic.

## Verification & Testing
1. **Backend Tests (`backend/main_test.go`)**:
   - `POST /api/rooms/create`: generates keys, rejects conflict on existing room without admin key.
   - `GET /api/rooms`: verifies keys are omitted from public directory.
   - `WebSocket Handshake`:
     - Admin with correct key $\rightarrow$ 101 Switching Protocols.
     - Admin with missing/wrong key $\rightarrow$ 401 Unauthorized.
     - Client with correct key $\rightarrow$ 101 Switching Protocols.
     - Client with missing/wrong key $\rightarrow$ 401 Unauthorized.
2. **Frontend Tests**:
   - `npm run lint` and `npm run build` pass cleanly.
3. **End-to-End Verification**:
   - Create room as admin, share link with embedded key to client, verify seamless join.
   - Open `/room/:roomId` directly without key, verify PIN prompt, enter PIN, verify instant connection.
   - Attempt to open `/admin/:roomId` without key or with wrong key, verify rejection.
