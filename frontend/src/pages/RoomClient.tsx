import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { InteractiveCanvas } from "../components/InteractiveCanvas";
import { Tv, AlertTriangle, MonitorPlay } from "lucide-react";

interface RoomState {
  roomId: string;
  imgUrl: string;
  x: number;
  y: number;
  scale: number;
  layout: string;
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
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

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
          setState(msg.payload);
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
          // Re-trigger useEffect connection
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

  const { imgUrl, x, y, scale, layout } = state;

  return (
    <div className="min-h-screen w-screen bg-[#06070a] text-gray-200 overflow-hidden flex flex-col relative select-none">
      
      {/* Tiny Status HUD in the Center or Corners */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2.5 bg-black/60 backdrop-blur-md px-3.5 py-1.5 border border-gray-900 rounded-full text-[11px] font-mono pointer-events-auto">
        <Tv className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-gray-300 font-bold uppercase">Room: {roomId}</span>
        <span className="h-3 w-px bg-gray-800" />
        <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
        <span className="text-gray-500">{wsConnected ? "SYNCED" : "OFFLINE"}</span>
      </div>

      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3.5 py-1.5 border border-gray-900 rounded-full text-[11px] font-mono pointer-events-auto">
        <button 
          onClick={() => navigate("/")}
          className="text-gray-400 hover:text-white transition-colors"
        >
          Exit Room
        </button>
      </div>

      {/* Main Multi-Angle Presentation Views */}
      <div className="flex-1 w-full h-full relative p-2 md:p-4 flex items-center justify-center">
        {errorMsg && (
          <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center p-6 text-center">
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
          <div className="w-full h-full flex items-center justify-center">
            
            {/* Viewport render logic */}
            {layout === "1" && (
              <div className="w-full h-full max-w-5xl aspect-[16/10] md:aspect-video bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900">
                <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
              </div>
            )}

            {layout === "2-tb" && (
              <div className="w-full h-full grid grid-rows-2 gap-3 md:gap-4 max-w-5xl aspect-[16/10] md:aspect-video">
                {/* Top Viewport - rotated 180° for opposite person */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-180">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    Top Screen (180°)
                  </span>
                </div>
                {/* Bottom Viewport - standard 0° for presenter */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    Bottom Screen (0°)
                  </span>
                </div>
              </div>
            )}

            {layout === "2-lr" && (
              <div className="w-full h-full grid grid-cols-2 gap-3 md:gap-4 max-w-5xl aspect-[16/10] md:aspect-video">
                {/* Left Viewport - rotated 90° */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-90">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    Left Side (90°)
                  </span>
                </div>
                {/* Right Viewport - rotated 270° (-90°) */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform -rotate-90">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    Right Side (270°)
                  </span>
                </div>
              </div>
            )}

            {layout === "4" && (
              <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-3 md:gap-4 max-w-5xl aspect-square md:aspect-video">
                {/* Top Left: North User (Rotated 180° so facing out from table center) */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-180">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    North (180°)
                  </span>
                </div>

                {/* Top Right: East User (Rotated 270° / -90°) */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform -rotate-90">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    East (270°)
                  </span>
                </div>

                {/* Bottom Left: West User (Rotated 90°) */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 transform rotate-90">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    West (90°)
                  </span>
                </div>

                {/* Bottom Right: South User (Rotated 0° - standard) */}
                <div className="relative w-full h-full bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900">
                  <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
                  <span className="absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none">
                    South (0°)
                  </span>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

    </div>
  );
};
