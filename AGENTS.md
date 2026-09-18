# AGENTS.md

TopView is a real-time tabletop presentation system designed for center-of-table screens. An admin controls image zooming/panning and viewport orientation, which synchronizes instantly over WebSockets to client displays arranged around a table.

## Architecture & Boundaries

The repository is split into two independent subdirectories:

- **`backend/`** (Go 1.22+): Single-binary HTTP & WebSocket server (`main.go`, `go.mod`).
  - WebSocket hub (`/ws`) manages rooms, broadcasts canvas state updates, and handles Cloud Run keepalive heartbeats.
  - File upload endpoint (`/api/upload`) accepts images up to 20MB, saving to `./uploads`.
  - Room directory endpoint (`/api/rooms`) lists active rooms and viewer counts.
  - Static SPA handler (`spaHandler`) serves `./dist` at `/` with index fallback.
- **`frontend/`** (React 19 + TypeScript + Vite 8 + Tailwind CSS v4):
  - Routes: `/` (`Home.tsx`), `/admin/:roomId` (`Admin.tsx`), `/room/:roomId` (`RoomClient.tsx`).
  - `src/components/InteractiveCanvas.tsx`: Drag-to-pan, wheel/touch-zoom canvas with normalized coordinates (`x`, `y`, `scale`).
  - `src/pages/Admin.tsx`: Host controls (preset picker, image URL/upload, layout selector, aspect ratio switcher, canvas pan/zoom, live layout preview).
  - `src/pages/RoomClient.tsx`: Multi-angle presentation client rendering synchronized viewports at 0°, 90°, 180°, and 270°.
- **`Dockerfile`**: Multi-stage build (Node builder -> Go builder -> Alpine runtime).

## Essential Commands

Always execute commands inside the relevant subdirectory (`backend/` or `frontend/`).

### Frontend (`cd frontend`)
- **Dev Server**: `npm run dev` (Runs Vite on `http://localhost:5173`)
- **Typecheck & Build**: `npm run build` (Runs `tsc -b && vite build` -> outputs to `dist/`)
- **Lint**: `npm run lint` (Runs `eslint .`)
- **Preview Build**: `npm run preview`

### Backend (`cd backend`)
- **Run Server**: `go run main.go` (Listens on `http://0.0.0.0:8080`)
- **Build Binary**: `go build -o topview-server main.go` (`topview-server` is gitignored)
- **Static Analysis & Tests**: `go vet ./... && go test ./...`

### Full-Stack Local Development
1. Start backend on `:8080`: `go run main.go` in `backend/`
2. Start frontend on `:5173`: `npm run dev` in `frontend/`
3. Vite proxies `/api`, `/ws` (with WebSocket upgrade), and `/uploads` directly to `http://localhost:8080`.

### Container Build
- Build: `docker build -t topview .`
- Run: `docker run -p 8080:8080 topview`

## WebSocket Protocol & State Model

- **Connection URL**: `/ws?roomId=<id>&role=<admin|client>`
- **Message format**: `{"type": "<type>", "payload": <RoomState>}`
- **Message types**:
  - `init`: Sent by server immediately upon connection with current room state.
  - `state_update`: Sent by admin on change; broadcast to all other connections in the room.
  - `ping` / `pong`: Connection heartbeats (server pings every 54s, expects pong within 60s).
- **`RoomState` Fields**:
  - `roomId` (`string`): Unique room identifier.
  - `imgUrl` (`string`): Upload URL (`/uploads/...`), external URL, or preset image.
  - `x` (`float64`): Normalized X offset percentage.
  - `y` (`float64`): Normalized Y offset percentage.
  - `scale` (`float64`): Zoom level (bounded between `0.1` and `15.0`).
  - `layout` (`string`): Viewport configuration:
    - `"1"`: Single center display (0°).
    - `"2-tb"`: Two copies stacked vertically: North (180°), South (0°).
    - `"2-lr"`: Two copies side-by-side: West (90°), East (270°).
    - `"3-trb"`: North (180°), East (270°), South (0°).
    - `"3-tlb"`: North (180°), West (90°), South (0°).
    - `"4"`: Four copies: North (180°), East (270°), South (0°), West (90°).
  - `aspectRatio` (`string`): Target client aspect ratio (e.g. `"16:9"`, `"16:10"`, `"4:3"`, `"1:1"`, `"21:9"`).

## Key Implementation Details & Gotchas

- **Rotated Viewports (90° / 270°)**: When rendering rotated side viewports in `Admin.tsx` preview and `RoomClient.tsx`, physical width/height are swapped and enclosed in an absolute container wrapper to prevent CSS layout overflowing parent flex containers.
- **In-Memory Rooms**: Active rooms and their states live in server memory in `hub.rooms`. Rooms are automatically pruned when the last client disconnects.
- **Cloud Run / Container Compatibility**: The Go server reads the `PORT` environment variable (`os.Getenv("PORT")`, defaulting to `8080`) and handles graceful shutdown via `SIGINT`/`SIGTERM` with active WebSocket closure frames.
