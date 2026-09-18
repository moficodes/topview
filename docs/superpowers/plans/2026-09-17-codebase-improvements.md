# TopView Codebase Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix security vulnerabilities, concurrency leaks, race conditions, ESLint errors, WebSocket reconnect bugs, and container best practices across the backend and frontend with unit test coverage.

**Architecture:** 
- Backend: Hardens `backend/main.go` with request size limiting, file type allowlisting/sniffing, state validation, role-based authorization for updates, safe client write channels to eliminate unbounded goroutines, and nil-safe SPA serving. Adds comprehensive Go unit and integration tests in `backend/main_test.go`.
- Frontend: Resolves all ESLint failures in `Admin.tsx`, `Home.tsx`, and `RoomClient.tsx`. Replaces broken WebSocket reconnect loops with robust retry logic. Upgrades `InteractiveCanvas.tsx` with pointer capture, touch pinch-to-zoom, update throttling, and image error handling.
- Docker: Implements unprivileged user execution (`appuser`) and direct multi-stage asset copying.

**Tech Stack:** Go 1.22, Gorilla WebSocket, React 19, TypeScript, Vite 8, Tailwind CSS v4, Docker.

---

### Task 1: Backend Security, Input Validation & Unit Tests

**Files:**
- Modify: `backend/main.go`
- Create: `backend/main_test.go`

- [ ] **Step 1: Write backend tests for upload validation, state validation, and role authorization**

Create `backend/main_test.go` testing:
1. `handleUpload` rejects files without images, enforces maximum size, validates allowed extensions (`.jpg`, `.jpeg`, `.png`, `.webp`), and sniffs MIME type.
2. `RoomState` validation rejects NaN/Inf scales, clamps/rejects invalid scales, rejects invalid layouts.
3. WebSocket rejects state updates from `role=client`.
4. `spaHandler` handles non-existent paths and permission scenarios without nil-pointer panics.

- [ ] **Step 2: Run tests to verify failure**

Run: `go test -v ./...` in `backend/`
Expected: FAIL (missing validation functions / handlers not yet updated)

- [ ] **Step 3: Implement security fixes in `backend/main.go`**

1. In `handleUpload`:
   - Wrap `r.Body` with `http.MaxBytesReader(w, r.Body, 20<<20)`.
   - Validate file extension against an allowlist: `.png`, `.jpg`, `.jpeg`, `.webp`.
   - Read the first 512 bytes to sniff MIME type with `http.DetectContentType` and verify it matches `image/jpeg`, `image/png`, or `image/webp`.
   - Return clear 400 Bad Request on validation errors.
2. In `handleWebSocket`:
   - Track role on each connection (`role == "admin"` vs `role == "client"`).
   - In `switch msg.Type`: For `state_update`, verify sender role is `"admin"`. If not, ignore or return error.
   - Validate `msg.Payload`:
     - Check `math.IsNaN(scale)` and `math.IsInf(scale, 0)`.
     - Clamp or enforce `scale >= 0.1 && scale <= 15.0`.
     - Validate `layout` is in `{"1", "2-tb", "2-lr", "3-trb", "3-tlb", "4"}`.
     - Validate `aspectRatio` is in `{"16:9", "16:10", "4:3", "1:1", "21:9"}` (defaulting to `"16:9"` if empty).
3. In `spaHandler`:
   - Fix nil pointer panic: Check `if err != nil` first; if `os.IsNotExist(err)` serve index.html, else return 500. Only check `fi.IsDir()` if `err == nil`.
4. Add security headers in HTTP handler middleware:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: SAMEORIGIN`

- [ ] **Step 4: Run backend tests and verify they pass**

Run: `go test -v ./...` in `backend/`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add backend/main.go backend/main_test.go
git commit -m "fix(backend): add upload validation, state verification, and role auth"
```

---

### Task 2: Backend Concurrency, Goroutine Safety & Room Pruning

**Files:**
- Modify: `backend/main.go`
- Test: `backend/main_test.go`

- [ ] **Step 1: Write concurrent broadcast and room pruning tests**

Add tests to `backend/main_test.go`:
1. `TestConcurrentBroadcast`: Multiple clients receiving high-frequency updates without goroutine pileup.
2. `TestRoomPruningRace`: Ensure room is not removed from hub while a new connection is joining.

- [ ] **Step 2: Run tests to verify failure/baseline**

Run: `go test -v -run "TestConcurrentBroadcast|TestRoomPruningRace" ./...` in `backend/`

- [ ] **Step 3: Implement client write pump and atomic room cleanup**

1. Replace unbounded `go func() { sc.WriteMessage(...) }` with a per-client outbound queue `send chan []byte` (buffered capacity 16):
   - Client write pump goroutine reads from `send` channel and writes to WebSocket.
   - When broadcasting canvas `state_update`, if a client's `send` buffer is full, drop the stale intermediate update (or drain older canvas state) so slow clients don't block the hub or leak goroutines.
2. In `removeConnection`:
   - Hold `hub.mu.Lock()` when checking client count and removing empty room, preventing the race condition where a new client joins right as an empty room is deleted.

- [ ] **Step 4: Run tests and `go vet`**

Run: `go test -race -v ./... && go vet ./...` in `backend/`
Expected: PASS with no race conditions or vet warnings.

- [ ] **Step 5: Commit changes**

```bash
git add backend/main.go backend/main_test.go
git commit -m "perf(backend): write pump with bounded channel and race-safe room cleanup"
```

---

### Task 3: Frontend ESLint Fixes & Build Stability

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/pages/RoomClient.tsx`

- [ ] **Step 1: Verify current lint errors**

Run: `npm run lint` in `frontend/`
Expected: 7 errors, 1 warning

- [ ] **Step 2: Fix lint errors in `Admin.tsx`**

1. Move `log` declaration above `useEffect` or wrap in `useCallback`.
2. Replace `details?: any` with `details?: unknown`.
3. In `getPreviewStyles`: initialize `wVis` and `hVis` directly via ternary or without redundant `0` assignment.

- [ ] **Step 3: Fix lint errors in `Home.tsx`**

1. Move `fetchRooms()` outside or manage initial loading state cleanly so `setState` is not called synchronously within the `useEffect` body.

- [ ] **Step 4: Fix lint errors in `RoomClient.tsx`**

1. In `RoomClient.tsx`: fix `wVis` and `hVis` assignments in layout `"2-lr"` calculation.

- [ ] **Step 5: Run lint and build to verify clean status**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors, 0 warnings. Build succeeds.

- [ ] **Step 6: Commit changes**

```bash
git add frontend/src/pages/Admin.tsx frontend/src/pages/Home.tsx frontend/src/pages/RoomClient.tsx
git commit -m "fix(frontend): resolve all eslint errors and warnings"
```

---

### Task 4: Frontend Reconnect, Interactive Canvas Gestures & Throttling

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`
- Modify: `frontend/src/pages/RoomClient.tsx`
- Modify: `frontend/src/components/InteractiveCanvas.tsx`

- [ ] **Step 1: Implement robust WebSocket reconnect in `Admin.tsx` and `RoomClient.tsx`**

1. Create an explicit reconnect mechanism (e.g. `connectWebSocket` function triggered with a reconnect timer and clean teardown) so when the connection drops, it actually establishes a new `WebSocket` instance instead of running a no-op `setState`.
2. Handle cleanup cleanly on component unmount (cancelling pending reconnect timers).

- [ ] **Step 2: Upgrade `InteractiveCanvas.tsx` with pointer capture and pinch-to-zoom**

1. Use pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`) and `setPointerCapture` so panning remains smooth even when the pointer moves outside the container.
2. Support multi-touch (2 touches) for pinch-to-zoom on touch screens / tabletop displays.
3. Add image error state fallback when `imgUrl` fails to load.
4. Remove redundant ternary `imgUrl.startsWith(...) ? imgUrl : imgUrl`.

- [ ] **Step 3: Add `requestAnimationFrame` / throttle to canvas state updates**

In `Admin.tsx`, throttle `sendStateUpdate` during drag movements using `requestAnimationFrame` so mouse moves at 144Hz/240Hz don't overwhelm network/WebSockets.

- [ ] **Step 4: Run lint and build verification**

Run: `npm run lint && npm run build` in `frontend/`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/pages/Admin.tsx frontend/src/pages/RoomClient.tsx frontend/src/components/InteractiveCanvas.tsx
git commit -m "feat(frontend): add reconnect logic, pointer capture, pinch-to-zoom, and update throttling"
```

---

### Task 5: Dockerfile Hardening & Multi-Stage Optimization

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Update `Dockerfile` to follow container security best practices**

1. Create and use an unprivileged system user `appuser` (`addgroup -S appgroup && adduser -S appuser -G appgroup`).
2. Set ownership of `/app/uploads` to `appuser:appgroup` with `chmod 750`.
3. Copy frontend assets directly from `frontend-builder` into the final Alpine runtime stage instead of passing through `backend-builder`.
4. Set `USER appuser`.

- [ ] **Step 2: Verify syntax and configuration**

Check `Dockerfile` structure and layer order.

- [ ] **Step 3: Commit changes**

```bash
git add Dockerfile
git commit -m "chore(docker): run container as unprivileged user and streamline build stages"
```

---

### Task 6: Comprehensive Verification & Final Review

**Files:**
- All modified files

- [ ] **Step 1: Run backend tests and vet**

Run: `go test -v -race ./... && go vet ./...` in `backend/`
Expected: All tests pass, no race conditions, no vet warnings.

- [ ] **Step 2: Run frontend typecheck, build, and lint**

Run: `npm run build && npm run lint` in `frontend/`
Expected: Build succeeds, 0 lint warnings/errors.

- [ ] **Step 3: Verify git status and diff**

Run: `git status && git log --oneline -5`
Expected: Clean working tree on branch `improvements`.
