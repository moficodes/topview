# Admin Full-Sidebar Layout Preview & Collapsible Sections Design

## Goal
Expand the Layout Preview in the admin sidebar to span the full available width of the sidebar (removing artificial constraints), and make all setup sections above it collapsible so the host can maximize visibility of the live player table layout.

## Background & Problem
In `Admin.tsx`, the Layout Preview was previously constrained by `max-w-[200px]` within a ~400px wide sidebar. This resulted in cramped, miniature viewports surrounded by excessive whitespace. Furthermore, the 4 sidebar configuration sections ("1. Choose Content", "2. Viewer Layout", "Client Aspect Ratio", "3. Viewport Controls") were permanently expanded, pushing the preview down and requiring vertical scrolling to inspect the live tabletop view.

## Design Details

### 1. Full-Sidebar-Width Layout Preview
- Remove `max-w-[200px]` / `max-w-[220px]` restriction from the preview container (`<div ref={previewContainerRef}>`).
- Give the container `w-full` with standard sidebar padding (`p-2` or `p-3`).
- The existing `ResizeObserver` measures `previewSize.width` and `previewSize.height` dynamically from `contentRect`.
- `TabletopViewports` receives the measured width and height, sizing the viewports to fill 100% of the available horizontal space while respecting the selected aspect ratio (`16:9`, `16:10`, `4:3`, `1:1`, `21:9`).

### 2. Collapsible Sections
The setup controls in the sidebar are converted into independent collapsible cards:
1. **Section: Content** (`openContent`, default: `true`):
   - Header: Title "1. Choose Content" with `Upload` / image icon.
   - Collapsed summary chip: Active image indicator (preset name or filename, or "No content").
   - Body: File upload dropzone, remote URL input, preset image buttons.
2. **Section: Layout** (`openLayout`, default: `false`):
   - Header: Title "2. Viewer Layout" with `Layout` icon.
   - Collapsed summary chip: Active layout label (e.g. `"1 Copy"`, `"4 Copies"`).
   - Body: Layout selector buttons ("1", "2-tb", "2-lr", "4", "3-trb", "3-tlb").
3. **Section: Aspect Ratio** (`openAspectRatio`, default: `false`):
   - Header: Title "Client Aspect Ratio" with `Maximize2` / screen icon.
   - Collapsed summary chip: Active ratio (e.g. `"16:9"`).
   - Body: Ratio buttons (`16:9`, `16:10`, `4:3`, `1:1`, `21:9`).
4. **Section: Viewport Controls** (`openControls`, default: `false`):
   - Header: Title "3. Viewport Controls" with `ZoomIn` / control icon.
   - Collapsed summary chip: Current scale (e.g. `"1.00x"`).
   - Body: Zoom In (+25%), Zoom Out (-20%), and Reset Center buttons.

### 3. Interactive Collapsible Header UX
- Each section header functions as a button (`w-full flex items-center justify-between py-2 hover:text-white cursor-pointer`).
- Left side: Section icon + Title + Chevron toggle (`ChevronDown` when expanded, `ChevronRight` when collapsed).
- Right side: Summary badge / chip visible when collapsed, or subtle count/status.
- Smooth CSS transition / conditional rendering of section bodies.

### 4. Layout Preview Placement & Header
- Positioned below the collapsible accordions.
- Header displays: Title "Live Table Preview" + Active layout chip + Active aspect ratio chip.
- Container: Bordered dark card with subtle glow (`bg-gray-950/90 rounded-2xl border border-gray-800/80`).

## Verification Plan
1. **Frontend Linting & Typecheck**: Run `npm run lint && npm run build` in `frontend/`.
2. **Visual Verification**:
   - Verify that clicking section headers expands and collapses them.
   - Verify summary chips display accurate state when collapsed.
   - Verify preview card expands to the full sidebar width (at least ~350px) without overflow.
   - Verify aspect ratios change the preview card height correctly without breaking viewports.
