import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { InteractiveCanvas } from "../components/InteractiveCanvas";
import { Tv, AlertTriangle, MonitorPlay, Maximize, Minimize } from "lucide-react";

interface RoomState {
  roomId: string;
  imgUrl: string;
  x: number;
  y: number;
  scale: number;
  layout: string;
  aspectRatio: string;
}

export const RoomClient: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<RoomState>({
    roomId: roomId || "",
    imgUrl: "",
    x: 0,
    y: 0,
    scale: 1,
    layout: "1",
    aspectRatio: "16:9",
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Measured main workspace space (reactive to parent flex container size, preventing scrollbars)
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });

  const wsRef = useRef<WebSocket | null>(null);

  // ResizeObserver to dynamically measure exact container boundaries
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries.length > 0) {
        const { width, height } = entries[0].contentRect;
        setWorkspaceSize({ width, height });
      }
    });

    if (workspaceRef.current) {
      observer.observe(workspaceRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Track browser fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // WebSocket Connection
  useEffect(() => {
    if (!roomId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?roomId=${roomId}&role=client`;

    console.log(`[Client:${roomId}] Connecting to WebSocket:`, wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setErrorMsg("");
      console.log(`[Client:${roomId}] WebSocket connected successfully`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "init" || msg.type === "state_update") {
          console.log(`[Client:${roomId}] State received:`, msg.payload);
          setState((prev) => ({
            ...prev,
            ...msg.payload,
            aspectRatio: msg.payload.aspectRatio || prev.aspectRatio || "16:9",
          }));
        }
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    };

    ws.onclose = (event) => {
      setWsConnected(false);
      console.log(`[Client:${roomId}] WebSocket disconnected:`, event);
      
      // Auto reconnect loop
      const timer = setTimeout(() => {
        if (wsRef.current === ws) {
          setState((prev) => ({ ...prev }));
        }
      }, 4000);

      return () => clearTimeout(timer);
    };

    ws.onerror = (err) => {
      console.error(`[Client:${roomId}] WebSocket error:`, err);
      setErrorMsg("WebSocket connection error. Please refresh or check server status.");
    };

    return () => {
      ws.close();
    };
  }, [roomId]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch((err) => console.error("Error enabling fullscreen:", err));
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const { imgUrl, x, y, scale, layout, aspectRatio } = state;

  // Calculates viewport dimensions to fit perfectly inside container bounds maintaining aspect ratio (contain fit)
  const calculateViewportSize = (availW: number, availH: number, ratioStr: string = "16:9") => {
    const safeRatio = ratioStr || "16:9";
    const parts = safeRatio.split(":");
    const rw = parts[0] ? Number(parts[0]) : 16;
    const rh = parts[1] ? Number(parts[1]) : 9;
    const aspect = (rw && rh) ? rw / rh : 16 / 9;
    
    if (availW / availH > aspect) {
      return {
        width: availH * aspect,
        height: availH,
      };
    } else {
      return {
        width: availW,
        height: availW / aspect,
      };
    }
  };

  // Dimensions computation
  let viewW = 0; // physical width of horizontal viewports
  let viewH = 0; // physical height of horizontal viewports
  let sideW = 0; // physical width of vertical viewports (before rotate)
  let sideH = 0; // physical height of vertical viewports (before rotate)
  const gap = 16; // gap in pixels between viewports

  if (workspaceSize.width > 0 && workspaceSize.height > 0) {
    const [rw, rh] = (aspectRatio || "16:9").split(":").map(Number);
    const aspect = (rw && rh) ? rw / rh : 16 / 9;

    if (layout === "1") {
      const { width, height } = calculateViewportSize(workspaceSize.width, workspaceSize.height, aspectRatio);
      viewW = width;
      viewH = height;
    } else if (layout === "2-tb") {
      const { width, height } = calculateViewportSize(workspaceSize.width, (workspaceSize.height - gap) / 2, aspectRatio);
      viewW = width;
      viewH = height;
    } else if (layout === "2-lr") {
      // 2 Columns of vertical screens. Each column is (workspaceSize.width - gap)/2 wide.
      const slotW = (workspaceSize.width - gap) / 2;
      const slotH = workspaceSize.height;
      const invAspect = 1 / aspect;
      if (slotW / slotH > invAspect) {
        viewH = slotW / invAspect;
        viewW = slotW;
      } else {
        viewW = slotH * invAspect;
        viewH = slotH;
      }
    } else if (layout === "3-trb" || layout === "3-tlb") {
      // 2 Columns: Center stack (2 rows) and 1 Side column
      // Fits horizontal aspect ratio perfectly in a 2-column tabletop setup without overlap.
      // Maximum center viewport height h:
      const hWidthLimit = (workspaceSize.width - gap) / (1 + aspect);
      const hHeightLimit = (workspaceSize.height - gap) / 2;
      const h = Math.min(hWidthLimit, hHeightLimit);
      
      viewH = h;
      viewW = h * aspect;
      
      // Side vertical screen matches the exact visual height of the center stack (2 * h + gap)
      // Since it is rotated 90/270deg, its physical width is (2 * h + gap) and physical height is h.
      sideW = 2 * h + gap;
      sideH = h;
    } else if (layout === "4") {
      // 3 Columns: West (side), Center Stack (2 rows), East (side)
      // Maximum center viewport height h:
      const hWidthLimit = (workspaceSize.width - 2 * gap) / (2 + aspect);
      const hHeightLimit = (workspaceSize.height - gap) / 2;
      const h = Math.min(hWidthLimit, hHeightLimit);
      
      viewH = h;
      viewW = h * aspect;
      
      // Side vertical screens match the exact visual height of the center stack (2 * h + gap)
      // Since they are rotated 90/270deg, physical width is (2 * h + gap) and physical height is h.
      sideW = 2 * h + gap;
      sideH = h;
    }
  }

  return (
    <div className="h-screen w-screen bg-[#06070a] text-gray-200 overflow-hidden flex flex-col relative select-none">
      
      {/* Floating HUD - Left Side: Room details */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2.5 bg-black/60 backdrop-blur-md px-3.5 py-1.5 border border-gray-900 rounded-full text-[11px] font-mono pointer-events-auto">
        <Tv className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-gray-300 font-bold uppercase">Room: {roomId}</span>
        <span className="h-3 w-px bg-gray-800" />
        <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
        <span className="text-gray-500">{wsConnected ? "SYNCED" : "OFFLINE"}</span>
      </div>

      {/* Floating HUD - Right Side: Actions (Exit, Full Screen toggle) */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1.2 border border-gray-900 rounded-full text-[11px] font-mono pointer-events-auto">
        <button 
          onClick={toggleFullscreen}
          className="p-1.5 hover:bg-white/10 rounded-full text-gray-300 hover:text-white transition-all mr-1"
          title={isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        </button>
        <span className="h-3 w-px bg-gray-800 mr-1" />
        <button 
          onClick={() => navigate("/")}
          className="text-gray-400 hover:text-white px-2 py-1 hover:bg-white/5 rounded-full transition-colors"
        >
          Exit
        </button>
      </div>

      {/* Main Presentation Workspace Area (sized exactly with padding-controlled flexbox) */}
      <div 
        ref={workspaceRef} 
        className="flex-1 w-full relative pt-16 p-4 flex items-center justify-center overflow-hidden"
      >
        {errorMsg && (
          <div className="absolute inset-0 bg-black/90 z-45 flex flex-col items-center justify-center p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-yellow-500 animate-bounce mb-3" />
            <h3 className="text-lg font-bold text-white mb-2">Connection Issues</h3>
            <p className="text-sm text-gray-400 max-w-sm">{errorMsg}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-xs font-mono font-bold rounded-xl transition-all"
            >
              Force Reload
            </button>
          </div>
        )}

        {!imgUrl ? (
          <div className="flex flex-col items-center justify-center text-center p-12 max-w-md mx-auto z-10 space-y-4">
            <div className="p-4 bg-purple-600/10 border border-purple-500/20 rounded-2xl text-purple-400 animate-pulse">
              <MonitorPlay className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white">Awaiting Presentation</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              This client screen is connected and synchronized with Room <code className="px-1.5 py-0.5 bg-gray-950 text-purple-400 border border-gray-900 rounded font-mono text-xs">{roomId}</code>. The presenter hasn't uploaded or selected an image yet.
            </p>
            <div className="text-[10px] font-mono text-gray-600 bg-gray-950/40 px-3 py-1.5 rounded-lg border border-gray-950">
              STATE: LISTENING FOR EVENTS
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center overflow-hidden">
            
            {/* Viewport render logic: Maximized and fitted mathematically with aspect ratio */}
            {layout === "1" && (
              <div 
                style={{ width: `${viewW}px`, height: `${viewH}px` }}
                className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
              >
                <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
              </div>
            )}

            {layout === "2-tb" && (
              <div className="flex flex-col gap-4 items-center justify-center w-full h-full">
                {/* Top Viewport - rotated 180° for opposite person */}
                <div 
                  style={{ width: `${viewW}px`, height: `${viewH}px` }}
                  className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-180"
                >
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    Top Screen (180°)
                  </span>
                </div>
                {/* Bottom Viewport - standard 0° for presenter */}
                <div 
                  style={{ width: `${viewW}px`, height: `${viewH}px` }}
                  className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                >
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    Bottom Screen (0°)
                  </span>
                </div>
              </div>
            )}

            {layout === "2-lr" && (
              <div className="flex gap-4 items-center justify-center w-full h-full">
                {/* Left Viewport - rotated 90° */}
                <div 
                  style={{ width: `${viewH}px`, height: `${viewW}px` }}
                  className="flex items-center justify-center relative"
                >
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px`, position: "absolute", transform: "rotate(90deg)" }}
                    className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      Left Side (90°)
                    </span>
                  </div>
                </div>
                {/* Right Viewport - rotated 270° */}
                <div 
                  style={{ width: `${viewH}px`, height: `${viewW}px` }}
                  className="flex items-center justify-center relative"
                >
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px`, position: "absolute", transform: "rotate(-90deg)" }}
                    className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      Right Side (270°)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {layout === "3-trb" && (
              <div className="flex gap-4 items-center justify-center w-full h-full">
                {/* Center Column: North and South Stack */}
                <div className="flex flex-col gap-4 items-center justify-center">
                  {/* Top: North (Rotated 180°) */}
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-180 m-auto"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      North (180°)
                    </span>
                  </div>

                  {/* Bottom: South (Rotated 0°) */}
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 m-auto"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      South (0°)
                    </span>
                  </div>
                </div>

                {/* Right Column: East (Rotated 270°) - Taller than it is long with absolute center wrapper */}
                <div 
                  style={{ width: `${sideH}px`, height: `${sideW}px` }}
                  className="flex items-center justify-center relative"
                >
                  <div 
                    style={{ width: `${sideW}px`, height: `${sideH}px`, position: "absolute", transform: "rotate(-90deg)" }}
                    className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      East (270°)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {layout === "3-tlb" && (
              <div className="flex gap-4 items-center justify-center w-full h-full">
                {/* Left Column: West (Rotated 90°) - Taller than it is long with absolute center wrapper */}
                <div 
                  style={{ width: `${sideH}px`, height: `${sideW}px` }}
                  className="flex items-center justify-center relative"
                >
                  <div 
                    style={{ width: `${sideW}px`, height: `${sideH}px`, position: "absolute", transform: "rotate(90deg)" }}
                    className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      West (90°)
                    </span>
                  </div>
                </div>

                {/* Right Column: North and South Stack */}
                <div className="flex flex-col gap-4 items-center justify-center">
                  {/* Top: North (Rotated 180°) */}
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-180 m-auto"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      North (180°)
                    </span>
                  </div>

                  {/* Bottom: South (Rotated 0°) */}
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 m-auto"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      South (0°)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {layout === "4" && (
              <div className="flex gap-4 items-center justify-center w-full h-full">
                {/* Left Column: West (Rotated 90°) - Taller than it is long with absolute center wrapper */}
                <div 
                  style={{ width: `${sideH}px`, height: `${sideW}px` }}
                  className="flex items-center justify-center relative"
                >
                  <div 
                    style={{ width: `${sideW}px`, height: `${sideH}px`, position: "absolute", transform: "rotate(90deg)" }}
                    className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      West (90°)
                    </span>
                  </div>
                </div>

                {/* Center Column: North and South Stack */}
                <div className="flex flex-col gap-4 items-center justify-center">
                  {/* Top: North (Rotated 180°) */}
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-180 m-auto"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      North (180°)
                    </span>
                  </div>

                  {/* Bottom: South (Rotated 0°) */}
                  <div 
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    className="relative bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 m-auto"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      South (0°)
                    </span>
                  </div>
                </div>

                {/* Right Column: East (Rotated 270°) - Taller than it is long with absolute center wrapper */}
                <div 
                  style={{ width: `${sideH}px`, height: `${sideW}px` }}
                  className="flex items-center justify-center relative"
                >
                  <div 
                    style={{ width: `${sideW}px`, height: `${sideH}px`, position: "absolute", transform: "rotate(-90deg)" }}
                    className="bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900"
                  >
                    <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                    <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                      East (270°)
                    </span>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

    </div>
  );
};
