import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { TabletopViewports } from "../components/TabletopViewports";
import { Tv, AlertTriangle, MonitorPlay, Maximize, Minimize, KeyRound, Lock, ArrowRight } from "lucide-react";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const urlKey = searchParams.get("key") || "";

  const [clientKey, setClientKey] = useState(urlKey);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(() => !urlKey);
  const [authError, setAuthError] = useState(() =>
    !urlKey ? "Enter the 6-digit passcode to join this presentation." : ""
  );
  const hasEverConnectedRef = useRef(false);

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
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Sync urlKey changes
  useEffect(() => {
    if (urlKey) {
      const timer = setTimeout(() => {
        setClientKey(urlKey);
        setNeedsPasscode(false);
        setAuthError("");
        hasEverConnectedRef.current = false;
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [urlKey]);

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

  // WebSocket Connection with automatic reconnection and backoff
  useEffect(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (!roomId) return;
    if (!clientKey) {
      const timer = setTimeout(() => {
        setNeedsPasscode(true);
      }, 0);
      return () => clearTimeout(timer);
    }

    let isUnmounted = false;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?roomId=${roomId}&role=client&key=${encodeURIComponent(clientKey)}`;

    console.log(`[Client:${roomId}] Connecting to WebSocket:`, wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isUnmounted) {
        ws.close();
        return;
      }
      hasEverConnectedRef.current = true;
      setWsConnected(true);
      setNeedsPasscode(false);
      setAuthError("");
      setErrorMsg("");
      reconnectAttemptsRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      console.log(`[Client:${roomId}] WebSocket connected successfully`);
    };

    // Client-side keepalive heartbeat every 25 seconds to prevent network idle timeouts
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);

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
      if (isUnmounted) return;
      console.log(`[Client:${roomId}] WebSocket disconnected:`, event);

      if (!hasEverConnectedRef.current) {
        setNeedsPasscode(true);
        setAuthError("Invalid passcode or room not found. Please verify the PIN.");
        return;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, up to 10s max
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
      reconnectAttemptsRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        if (!isUnmounted) {
          setReconnectTrigger((prev) => prev + 1);
        }
      }, delay);
    };

    ws.onerror = (err) => {
      console.error(`[Client:${roomId}] WebSocket error:`, err);
      if (reconnectAttemptsRef.current >= 2) {
        setErrorMsg("WebSocket connection error. Reconnecting...");
      }
    };

    return () => {
      isUnmounted = true;
      clearInterval(heartbeatInterval);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      ws.onclose = null;
      ws.close();
    };
  }, [roomId, clientKey, reconnectTrigger]);

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcodeInput.trim()) return;
    const pin = passcodeInput.trim();
    setAuthError("");
    setClientKey(pin);
    setSearchParams({ key: pin });
    setNeedsPasscode(false);
    setReconnectTrigger((prev) => prev + 1);
  };

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

  return (
    <div className="h-screen w-screen bg-[#06070a] text-gray-200 overflow-hidden flex flex-col relative select-none">
      
      {/* Floating HUD - Left Side: Room details */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2.5 bg-black/60 backdrop-blur-md px-3.5 py-1.5 border border-gray-900 rounded-full text-[11px] font-mono pointer-events-auto">
        <Tv className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-gray-300 font-bold uppercase">Room: {roomId}</span>
        {clientKey && <Lock className="w-3 h-3 text-purple-400" />}
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
          <TabletopViewports
            imgUrl={imgUrl}
            x={x}
            y={y}
            scale={scale}
            layout={layout}
            aspectRatio={aspectRatio}
            containerWidth={workspaceSize.width}
            containerHeight={workspaceSize.height}
            isMini={false}
          />
        )}
      </div>

      {/* Passcode Dialog */}
      {needsPasscode && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#111219] border border-gray-800 p-6 md:p-8 rounded-2xl max-w-sm w-full shadow-2xl space-y-5 text-center">
            <div className="w-12 h-12 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Enter Room Passcode</h2>
              <p className="text-xs text-gray-400 mt-1 font-mono">Room: <span className="text-purple-400 font-bold">{roomId}</span></p>
            </div>
            {authError && (
              <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2 rounded-lg font-medium">
                {authError}
              </p>
            )}
            <form onSubmit={handlePasscodeSubmit} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="6-digit PIN (e.g. 482195)"
                className="w-full text-center tracking-widest text-lg font-mono px-4 py-3 bg-gray-950 border border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 text-white placeholder-gray-600"
                required
              />
              <button
                type="submit"
                disabled={!passcodeInput.trim()}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold rounded-xl text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed shadow-lg shadow-purple-600/20"
              >
                <span>Join Presentation</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors py-1 cursor-pointer font-mono"
              >
                Return to Home
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
