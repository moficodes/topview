# Admin Full-Sidebar Layout Preview & Collapsible Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Layout Preview in the admin view to fill the full width of the sidebar column and make all configuration sections collapsible, giving the host a prominent view of the table displays.

**Architecture:** 
- In `frontend/src/pages/Admin.tsx`:
  - Introduce independent toggle states for the 4 setup sections (`openContent`, `openLayout`, `openAspectRatio`, `openControls`) with "Content" open by default and others collapsed.
  - Render collapsible section headers with chevron icons (`ChevronDown` / `ChevronRight`) and summary chips showing current selection when collapsed.
  - Expand the preview container from `max-w-[200px]` to `w-full`, allowing `ResizeObserver` and `TabletopViewports` to utilize 100% of the available horizontal sidebar width (~360–440px).
- Verification & Deployment:
  - Run linting and TypeScript production build.
  - Build container image `v1.3.2` and deploy to Cloud Run with 1 always-on instance.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Google Cloud Run.

---

### Task 1: Collapsible Sections in Admin Sidebar

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`

- [ ] **Step 1: Add collapsible state and chevron icons**

In `frontend/src/pages/Admin.tsx`:
1. Import `ChevronDown` and `ChevronRight` from `lucide-react`.
2. Add section open/collapsed state hooks:
   ```typescript
   const [openContent, setOpenContent] = useState(true);
   const [openLayout, setOpenLayout] = useState(false);
   const [openAspectRatio, setOpenAspectRatio] = useState(false);
   const [openControls, setOpenControls] = useState(false);
   ```
3. Wrap each sidebar section in a collapsible structure with an interactive button header:
   - Header has section icon, title, chevron, and summary chip when collapsed:
     - Content chip: active preset name, or `"Uploaded"` or `"No content"`
     - Layout chip: `getLayoutLabel(layout)`
     - Aspect ratio chip: `aspectRatio`
     - Controls chip: `${scale.toFixed(2)}x`
   - Body is conditionally rendered when open.

- [ ] **Step 2: Run frontend lint and build to verify changes**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit changes**

```bash
git add frontend/src/pages/Admin.tsx
git commit -m "feat(frontend): make admin sidebar setup sections collapsible"
```

---

### Task 2: Full-Width Layout Preview Container

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`

- [ ] **Step 1: Expand preview container to full width**

In `frontend/src/pages/Admin.tsx`:
1. Remove `max-w-[200px]` / `max-w-[220px]` restriction from `<div ref={previewContainerRef}>`.
2. Apply `w-full` so it spans the entire inner width of the sidebar column.
3. Enhance the Layout Preview card header with clear labels: "Live Table Preview", layout chip, and aspect ratio chip.
4. Ensure the `ResizeObserver` cleanly updates `previewSize` across window resize and section collapses.

- [ ] **Step 2: Run frontend lint and build**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit changes**

```bash
git add frontend/src/pages/Admin.tsx
git commit -m "feat(frontend): make layout preview take full width of sidebar"
```

---

### Task 3: Comprehensive Verification

**Files:**
- All files

- [ ] **Step 1: Verify backend tests and race detector**

Run: `go test -race ./... && go vet ./...` in `backend/`
Expected: PASS.

- [ ] **Step 2: Verify frontend typecheck and lint**

Run: `npm run lint && npm run build` in `frontend/`
Expected: PASS with 0 warnings.

---

### Task 4: Container Build & Cloud Run Redeployment

**Files:**
- Dockerfile / Cloud Run

- [ ] **Step 1: Submit Cloud Build image v1.3.2**

Run: `gcloud builds submit --tag us-docker.pkg.dev/mofilabs/tabletop/presenter:v1.3.2`
Expected: SUCCESS.

- [ ] **Step 2: Deploy to Cloud Run**

Run:
```bash
gcloud run deploy tabletop-presenter \
  --image=us-docker.pkg.dev/mofilabs/tabletop/presenter:v1.3.2 \
  --region=us-central1 \
  --min-instances=1 \
  --max-instances=1 \
  --timeout=3600 \
  --no-cpu-throttling \
  --session-affinity \
  --platform=managed
```
Expected: Deployed successfully and serving 100% of traffic.

- [ ] **Step 3: Verify live endpoint**

Run: `curl -sI https://tabletop-presenter-598464211339.us-central1.run.app/`
Expected: HTTP/2 200 OK.
