import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { InteractiveCanvas } from "../components/InteractiveCanvas";
import { TabletopViewports } from "../components/TabletopViewports";
import {
  ArrowLeft,
  Upload,
  Copy,
  Check,
  Layout,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Tv,
  Key,
  ShieldAlert,
} from "lucide-react";

interface RoomState {
  roomId: string;
  imgUrl: string;
  x: number;
  y: number;
  scale: number;
  layout: string;
  aspectRatio: string;
}

const PRESET_IMAGES = [
  {
    name: "Coordinate Grid",
    url: "https://images.unsplash.com/photo-1544383835-bda2bc66a55d?q=80&w=600&auto=format&fit=crop",
  },
  {
    name: "Boardroom Plan",
    url: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?q=80&w=600&auto=format&fit=crop",
  },
  {
    name: "Interactive Diagram",
    url: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?q=80&w=600&auto=format&fit=crop",
  },
];

export const Admin: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const adminKey = searchParams.get("key") || "";

  const [clientKey, setClientKey] = useState("");
  const [pinCopied, setPinCopied] = useState(false);
  const [authError, setAuthError] = useState("");
  const [keyInput, setKeyInput] = useState("");

  const [imgUrl, setImgUrl] = useState("");
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [scale, setScale] = useState(1);
  const [layout, setLayout] = useState("1"); // "1", "2-tb", "2-lr", "3-trb", "3-tlb", "4"
  const [copied, setCopied] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");

  const [openContent, setOpenContent] = useState(true);
  const [openLayout, setOpenLayout] = useState(false);
  const [openAspectRatio, setOpenAspectRatio] = useState(false);
  const [openControls, setOpenControls] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Latest state ref for callbacks and re-sync
  const stateRef = useRef({ imgUrl, x, y, scale, layout, aspectRatio });
  useEffect(() => {
    stateRef.current = { imgUrl, x, y, scale, layout, aspectRatio };
  }, [imgUrl, x, y, scale, layout, aspectRatio]);

  // Measured preview container dimensions
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      if (entries.length > 0) {
        const { width, height } = entries[0].contentRect;
        setPreviewSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // RequestAnimationFrame throttling refs
  const pendingUpdateRef = useRef<Partial<RoomState> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const log = useCallback(
    (msg: string, details?: unknown) => {
      console.log(`[Admin:${roomId}] ${msg}`, details || "");
    },
    [roomId]
  );

  const buildPayload = useCallback(
    (update: Partial<RoomState>): RoomState => {
      const current = stateRef.current;
      return {
        roomId: roomId || "",
        imgUrl: update.imgUrl !== undefined ? update.imgUrl : current.imgUrl,
        x: update.x !== undefined ? update.x : current.x,
        y: update.y !== undefined ? update.y : current.y,
        scale: update.scale !== undefined ? update.scale : current.scale,
        layout: update.layout !== undefined ? update.layout : current.layout,
        aspectRatio:
          update.aspectRatio !== undefined ? update.aspectRatio : current.aspectRatio,
      };
    },
    [roomId]
  );

  // Flush any pending throttled updates immediately
  const flushPendingUpdates = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (!pendingUpdateRef.current) return;
    const updateToSend = pendingUpdateRef.current;
    pendingUpdateRef.current = null;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(
      JSON.stringify({
        type: "state_update",
        payload: buildPayload(updateToSend),
      })
    );
  }, [buildPayload]);

  // Sync state over WebSocket whenever it changes (with optional rAF throttling)
  const sendStateUpdate = useCallback(
    (newState: Partial<RoomState>, immediate = true) => {
      if (immediate) {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const mergedState = {
          ...(pendingUpdateRef.current || {}),
          ...newState,
        };
        pendingUpdateRef.current = null;

        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(
          JSON.stringify({
            type: "state_update",
            payload: buildPayload(mergedState),
          })
        );
      } else {
        // Throttled update via requestAnimationFrame
        pendingUpdateRef.current = {
          ...(pendingUpdateRef.current || {}),
          ...newState,
        };

        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            if (pendingUpdateRef.current) {
              const updateToSend = pendingUpdateRef.current;
              pendingUpdateRef.current = null;

              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

              wsRef.current.send(
                JSON.stringify({
                  type: "state_update",
                  payload: buildPayload(updateToSend),
                })
              );
            }
          });
        }
      }
    },
    [buildPayload]
  );

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Set up WebSocket connection with automatic reconnect
  useEffect(() => {
    if (!roomId) return;

    if (!adminKey) {
      const timer = setTimeout(() => {
        setAuthError("Admin key is missing. Please enter the admin key to manage this room.");
        setWsConnected(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    let isUnmounted = false;
    let hasOpened = false;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?roomId=${roomId}&role=admin&key=${encodeURIComponent(adminKey)}`;

    log("Connecting WebSocket to " + wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isUnmounted) {
        ws.close();
        return;
      }
      hasOpened = true;
      setAuthError("");
      setWsConnected(true);
      reconnectAttemptsRef.current = 0;
      log("WebSocket connected");
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
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
        if (msg.type === "init") {
          log("WebSocket init state received", msg.payload);
          if (msg.clientKey) {
            setClientKey(msg.clientKey);
          }
          const p = msg.payload;
          if (p) {
            if (p.imgUrl) {
              setImgUrl(p.imgUrl);
              setX(p.x || 0);
              setY(p.y || 0);
              setScale(p.scale || 1);
              setLayout(p.layout || "1");
              setAspectRatio(p.aspectRatio || "16:9");
            } else if (stateRef.current.imgUrl) {
              // Restore previous state if server reconnected and room was reset
              sendStateUpdate({}, true);
            }
          }
        }
      } catch (err) {
        console.error("Error parsing WS message:", err);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      if (isUnmounted) return;
      if (!hasOpened) {
        setAuthError("Unauthorized: Invalid admin key or failed to connect to room.");
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
      reconnectAttemptsRef.current += 1;
      log(`WebSocket disconnected, scheduling reconnect in ${delay}ms...`);
      if (reconnectAttemptsRef.current > 5) {
        setAuthError("Connection lost. Unable to reconnect to room.");
      }
      reconnectTimerRef.current = setTimeout(() => {
        if (!isUnmounted) {
          setReconnectTrigger((prev) => prev + 1);
        }
      }, delay);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
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
  }, [roomId, adminKey, reconnectTrigger, log, sendStateUpdate]);

  const handleCanvasChange = (state: { x: number; y: number; scale: number }) => {
    setX(state.x);
    setY(state.y);
    setScale(state.scale);
    sendStateUpdate({ x: state.x, y: state.y, scale: state.scale }, false);
  };

  const handleDragEnd = useCallback(() => {
    flushPendingUpdates();
  }, [flushPendingUpdates]);

  const handleLayoutChange = (newLayout: string) => {
    setLayout(newLayout);
    sendStateUpdate({ layout: newLayout }, true);
  };

  const handleImageSelect = (url: string) => {
    setImgUrl(url);
    setX(0);
    setY(0);
    setScale(1);
    sendStateUpdate({ imgUrl: url, x: 0, y: 0, scale: 1 }, true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("image", file);

    setIsUploading(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        handleImageSelect(data.url);
      } else {
        alert("Failed to upload image. Please try again.");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading file.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleUrlInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrlInput.trim()) return;
    handleImageSelect(imageUrlInput.trim());
    setImageUrlInput("");
  };

  const handleResetCanvas = () => {
    setX(0);
    setY(0);
    setScale(1);
    sendStateUpdate({ x: 0, y: 0, scale: 1 });
  };

  const handleZoom = (factor: number) => {
    const newScale = Math.max(0.1, Math.min(15, scale + factor * scale));
    setScale(newScale);
    sendStateUpdate({ scale: newScale });
  };

  const copyClientLink = () => {
    const clientUrl = `${window.location.protocol}//${window.location.host}/room/${roomId}${
      clientKey ? `?key=${clientKey}` : ""
    }`;
    navigator.clipboard.writeText(clientUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setAuthError("");
    setSearchParams({ key: keyInput.trim() });
    setReconnectTrigger((prev) => prev + 1);
  };

  const getLayoutLabel = (l: string) => {
    switch (l) {
      case "1":
        return "1 Copy (Center)";
      case "2-tb":
        return "2 Copies (Top & Bottom)";
      case "2-lr":
        return "2 Copies (Left & Right)";
      case "3-trb":
        return "3 Copies (Top, Right, Bottom)";
      case "3-tlb":
        return "3 Copies (Top, Left, Bottom)";
      case "4":
        return "4 Copies (All Sides)";
      default:
        return "Standard";
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0e12] text-gray-200 flex flex-col">
      {/* Navbar */}
      <header className="bg-[#12131a] border-b border-gray-900 px-4 py-3 md:px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-xl transition-all"
            title="Go back to Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="h-5 w-px bg-gray-800" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">
                Room: {roomId}
              </h1>
              <span
                className={`w-2 h-2 rounded-full ${
                  wsConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
                }`}
                title={wsConnected ? "WebSocket Connected" : "WebSocket Disconnected"}
              />
            </div>
            <p className="text-[10px] text-gray-500 font-mono">ADMIN CONTROL PANEL</p>
          </div>
        </div>

        {/* Link Share */}
        <div className="flex items-center gap-2">
          {clientKey && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(clientKey);
                setPinCopied(true);
                setTimeout(() => setPinCopied(false), 2000);
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-900/90 border border-gray-800 hover:border-purple-500/50 rounded-lg text-xs font-mono text-purple-300 transition-all cursor-pointer"
              title="Click to copy participant passcode"
            >
              <span className="text-gray-500 text-[10px]">PIN:</span>
              <span className="font-bold tracking-widest">{clientKey}</span>
              {pinCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-gray-400" />}
            </button>
          )}
          <span className="text-xs text-gray-500 font-mono hidden sm:block">
            Viewer Link:
          </span>
          <button
            onClick={copyClientLink}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/10 hover:bg-purple-600/25 border border-purple-500/30 text-purple-400 font-mono text-xs rounded-xl transition-all"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Share Room URL
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left Control Column */}
        <aside className="lg:col-span-4 bg-[#111219] border-r border-gray-900/80 p-5 space-y-4 overflow-y-auto max-h-screen">
          {/* Section 1: Content Upload */}
          <div className="border border-gray-900/80 bg-gray-950/40 rounded-xl p-3">
            <button
              type="button"
              aria-expanded={openContent}
              onClick={() => setOpenContent((prev) => !prev)}
              className="w-full flex items-center justify-between py-2 text-xs font-bold font-mono text-gray-400 hover:text-white transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                {openContent ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                )}
                <Upload className="w-4 h-4 text-purple-400 shrink-0" />
                <span>1. Choose Content</span>
              </div>
              {!openContent && (
                <span className="text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded truncate max-w-[140px]">
                  {imgUrl
                    ? PRESET_IMAGES.find((p) => p.url === imgUrl)?.name || "Custom Image"
                    : "None"}
                </span>
              )}
            </button>

            {openContent && (
              <div className="pt-3 border-t border-gray-900/60 mt-1 space-y-3">
                {/* Local file upload */}
                <label className="flex flex-col items-center justify-center p-4 border border-dashed border-gray-800 rounded-xl hover:border-purple-500/50 hover:bg-purple-500/5 transition-all cursor-pointer group text-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={isUploading}
                    className="hidden"
                  />
                  <Upload className="w-6 h-6 text-gray-500 group-hover:text-purple-400 mb-2 transition-colors" />
                  <span className="text-xs font-medium text-gray-300">
                    {isUploading ? "Uploading file..." : "Upload local image"}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono mt-1">
                    PNG, JPG, WebP up to 20MB
                  </span>
                </label>

                {/* Paste URL */}
                <form onSubmit={handleUrlInputSubmit} className="flex gap-1.5 pt-1">
                  <input
                    type="url"
                    placeholder="Paste remote image URL..."
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-800 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 text-gray-300"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 bg-gray-900 border border-gray-800 hover:border-purple-500/50 hover:text-white rounded-lg text-xs transition-all font-semibold"
                  >
                    Load
                  </button>
                </form>

                {/* Preset Images */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] text-gray-500 font-mono">OR TRY SAMPLE PRESETS</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PRESET_IMAGES.map((img) => (
                      <button
                        key={img.name}
                        onClick={() => handleImageSelect(img.url)}
                        className={`p-1 border rounded-lg overflow-hidden h-14 relative group ${
                          imgUrl === img.url
                            ? "border-purple-500 bg-purple-500/10"
                            : "border-gray-800 bg-gray-950 hover:border-gray-700"
                        }`}
                      >
                        <img
                          src={img.url}
                          alt={img.name}
                          className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-black/80 py-0.5 text-[8px] text-center text-gray-300 truncate">
                          {img.name}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Viewer Layout */}
          <div className="border border-gray-900/80 bg-gray-950/40 rounded-xl p-3">
            <button
              type="button"
              aria-expanded={openLayout}
              onClick={() => setOpenLayout((prev) => !prev)}
              className="w-full flex items-center justify-between py-2 text-xs font-bold font-mono text-gray-400 hover:text-white transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                {openLayout ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                )}
                <Layout className="w-4 h-4 text-purple-400 shrink-0" />
                <span>2. Viewer Layout</span>
              </div>
              {!openLayout && (
                <span className="text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded truncate max-w-[140px]">
                  {getLayoutLabel(layout)}
                </span>
              )}
            </button>

            {openLayout && (
              <div className="pt-3 border-t border-gray-900/60 mt-1 space-y-3">
                <p className="text-[11px] text-gray-500">
                  Configure how many copies are shown on the table client and their rotations so everyone can view it right side up.
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {/* Preset 1: Single Center */}
                  <button
                    onClick={() => handleLayoutChange("1")}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-2 text-center transition-all ${
                      layout === "1"
                        ? "border-purple-500 bg-purple-500/10 text-white"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div className="w-10 h-10 border border-gray-700 rounded bg-gray-900/60 flex items-center justify-center relative">
                      <span className="w-4 h-4 rounded bg-purple-500 flex items-center justify-center text-[8px] text-white">0°</span>
                    </div>
                    <div className="font-semibold text-xs">1 Copy</div>
                    <div className="text-[9px] text-gray-500">Single center</div>
                  </button>

                  {/* Preset 2: Top/Bottom */}
                  <button
                    onClick={() => handleLayoutChange("2-tb")}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-2 text-center transition-all ${
                      layout === "2-tb"
                        ? "border-purple-500 bg-purple-500/10 text-white"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div className="w-10 h-10 border border-gray-700 rounded bg-gray-900/60 flex flex-col justify-between items-center p-1">
                      <span className="w-4 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[7px] text-white rotate-180">0°</span>
                      <span className="w-4 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[7px] text-white">0°</span>
                    </div>
                    <div className="font-semibold text-xs">2 Copies (T-B)</div>
                    <div className="text-[9px] text-gray-500">Sitting opposite</div>
                  </button>

                  {/* Preset 3: Left/Right */}
                  <button
                    onClick={() => handleLayoutChange("2-lr")}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-2 text-center transition-all ${
                      layout === "2-lr"
                        ? "border-purple-500 bg-purple-500/10 text-white"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div className="w-10 h-10 border border-gray-700 rounded bg-gray-900/60 flex justify-between items-center p-1">
                      <span className="w-3.5 h-4 rounded bg-purple-500 flex items-center justify-center text-[7px] text-white rotate-90">0°</span>
                      <span className="w-3.5 h-4 rounded bg-purple-500 flex items-center justify-center text-[7px] text-white -rotate-90">0°</span>
                    </div>
                    <div className="font-semibold text-xs">2 Copies (L-R)</div>
                    <div className="text-[9px] text-gray-500">Sitting sides</div>
                  </button>

                  {/* Preset 4: Four Sided */}
                  <button
                    onClick={() => handleLayoutChange("4")}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-2 text-center transition-all ${
                      layout === "4"
                        ? "border-purple-500 bg-purple-500/10 text-white"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div className="w-10 h-10 border border-gray-700 rounded bg-gray-900/60 grid grid-cols-2 gap-1 p-1">
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white rotate-180 m-auto">N</span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white -rotate-90 m-auto">E</span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white rotate-90 m-auto">W</span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white m-auto">S</span>
                    </div>
                    <div className="font-semibold text-xs">4 Copies</div>
                    <div className="text-[9px] text-gray-500">Full table round</div>
                  </button>

                  {/* Preset 5: 3 Sided TRB */}
                  <button
                    onClick={() => handleLayoutChange("3-trb")}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-2 text-center transition-all ${
                      layout === "3-trb"
                        ? "border-purple-500 bg-purple-500/10 text-white"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div className="w-10 h-10 border border-gray-700 rounded bg-gray-900/60 grid grid-cols-2 gap-1 p-1">
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white rotate-180 m-auto">N</span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white -rotate-90 m-auto">E</span>
                      <span className="w-3.5 h-3.5 rounded bg-gray-800/40 m-auto opacity-20"></span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white m-auto">S</span>
                    </div>
                    <div className="font-semibold text-xs">3 Copies (TRB)</div>
                    <div className="text-[9px] text-gray-500">No West seat</div>
                  </button>

                  {/* Preset 6: 3 Sided TLB */}
                  <button
                    onClick={() => handleLayoutChange("3-tlb")}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-2 text-center transition-all ${
                      layout === "3-tlb"
                        ? "border-purple-500 bg-purple-500/10 text-white"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div className="w-10 h-10 border border-gray-700 rounded bg-gray-900/60 grid grid-cols-2 gap-1 p-1">
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white rotate-180 m-auto">N</span>
                      <span className="w-3.5 h-3.5 rounded bg-gray-800/40 m-auto opacity-20"></span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white rotate-90 m-auto">W</span>
                      <span className="w-3.5 h-3.5 rounded bg-purple-500 flex items-center justify-center text-[6px] text-white m-auto">S</span>
                    </div>
                    <div className="font-semibold text-xs">3 Copies (TLB)</div>
                    <div className="text-[9px] text-gray-500">No East seat</div>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Aspect Ratio Selection */}
          <div className="border border-gray-900/80 bg-gray-950/40 rounded-xl p-3">
            <button
              type="button"
              aria-expanded={openAspectRatio}
              onClick={() => setOpenAspectRatio((prev) => !prev)}
              className="w-full flex items-center justify-between py-2 text-xs font-bold font-mono text-gray-400 hover:text-white transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                {openAspectRatio ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                )}
                <Maximize2 className="w-4 h-4 text-purple-400 shrink-0" />
                <span>3. Client Aspect Ratio</span>
              </div>
              {!openAspectRatio && (
                <span className="text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded truncate max-w-[140px]">
                  {aspectRatio}
                </span>
              )}
            </button>

            {openAspectRatio && (
              <div className="pt-3 border-t border-gray-900/60 mt-1 space-y-3">
                <p className="text-[11px] text-gray-500">
                  Set the proportion of the screen layout viewports for the connected clients.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["16:9", "16:10", "4:3", "1:1", "21:9"].map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => {
                        setAspectRatio(ratio);
                        sendStateUpdate({ aspectRatio: ratio });
                      }}
                      className={`flex-1 px-2.5 py-1.5 border text-xs font-mono rounded-lg font-semibold transition-all ${
                        aspectRatio === ratio
                          ? "border-purple-500 bg-purple-500/10 text-white"
                          : "border-gray-800 bg-gray-950 text-gray-400 hover:text-gray-200 hover:border-gray-700"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Quick Controls */}
          <div className="border border-gray-900/80 bg-gray-950/40 rounded-xl p-3">
            <button
              type="button"
              aria-expanded={openControls}
              onClick={() => setOpenControls((prev) => !prev)}
              className="w-full flex items-center justify-between py-2 text-xs font-bold font-mono text-gray-400 hover:text-white transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                {openControls ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                )}
                <ZoomIn className="w-4 h-4 text-purple-400 shrink-0" />
                <span>4. Viewport Controls</span>
              </div>
              {!openControls && (
                <span className="text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded truncate max-w-[140px]">
                  {`${scale.toFixed(2)}x`}
                </span>
              )}
            </button>

            {openControls && (
              <div className="pt-3 border-t border-gray-900/60 mt-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleZoom(0.25)}
                    disabled={!imgUrl}
                    className="flex-1 py-2 bg-gray-950 hover:bg-gray-900 disabled:opacity-40 border border-gray-800 rounded-xl text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ZoomIn className="w-4 h-4" /> Zoom In
                  </button>
                  <button
                    onClick={() => handleZoom(-0.2)}
                    disabled={!imgUrl}
                    className="flex-1 py-2 bg-gray-950 hover:bg-gray-900 disabled:opacity-40 border border-gray-800 rounded-xl text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ZoomOut className="w-4 h-4" /> Zoom Out
                  </button>
                  <button
                    onClick={handleResetCanvas}
                    disabled={!imgUrl}
                    className="flex-1 py-2 bg-purple-900/20 hover:bg-purple-900/40 border border-purple-500/20 disabled:opacity-40 rounded-xl text-xs text-purple-400 font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" /> Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mini Live Preview Block */}
          <div className="border border-gray-900/80 bg-gray-950/40 rounded-xl p-3 space-y-3">
            <div className="flex justify-between items-center py-2 gap-2">
              <h3 className="text-xs font-bold font-mono text-gray-400 tracking-wider uppercase flex items-center gap-1.5">
                <Tv className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                Live Tabletop Preview
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded truncate max-w-[140px]">
                  {getLayoutLabel(layout)}
                </span>
                <span className="text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded">
                  {aspectRatio}
                </span>
              </div>
            </div>

            <div 
              ref={previewContainerRef}
              className="w-full bg-gray-950 rounded-xl border border-gray-900 overflow-hidden relative flex p-2.5 items-center justify-center transition-all"
              style={{
                aspectRatio: (aspectRatio || "16:9").replace(":", "/"),
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />

              <TabletopViewports
                imgUrl={imgUrl}
                x={x}
                y={y}
                scale={scale}
                layout={layout}
                aspectRatio={aspectRatio}
                containerWidth={previewSize.width}
                containerHeight={previewSize.height}
                isMini={true}
              />
            </div>
          </div>
        </aside>

        {/* Main interactive Canvas Panel */}
        <main className="lg:col-span-8 bg-[#09090d] flex flex-col p-4 md:p-6 overflow-hidden">
          {/* Header instructions */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4 bg-[#111219] p-4 rounded-2xl border border-gray-900">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-purple-400 animate-pulse" /> Active Presenter Workspace
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Drag the canvas with your mouse to pan, scroll to zoom. Changes mirror immediately to all connected clients.
              </p>
            </div>
            <button
              onClick={handleResetCanvas}
              disabled={!imgUrl}
              className="px-3 py-1.5 bg-gray-950 hover:bg-gray-900 border border-gray-800 hover:border-purple-500/40 text-gray-300 rounded-xl text-xs transition-all font-mono"
            >
              Reset Center
            </button>
          </div>

          {/* Interactive Canvas container */}
          <div className="flex-1 min-h-[350px] relative">
            <InteractiveCanvas
              imgUrl={imgUrl}
              x={x}
              y={y}
              scale={scale}
              onChange={handleCanvasChange}
              onDragEnd={handleDragEnd}
            />
          </div>
        </main>
      </div>

      {/* Admin Authentication Required Modal */}
      {authError && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#13141c] border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Admin Authentication Required</h2>
                <p className="text-xs text-gray-400 font-mono">Room: {roomId}</p>
              </div>
            </div>

            <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 p-3 rounded-xl leading-relaxed">
              {authError}
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="adminKeyInput" className="block text-xs font-medium text-gray-400">
                  Admin Passkey
                </label>
                <input
                  id="adminKeyInput"
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Enter admin key (e.g. adm_...)"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 text-sm font-mono text-white placeholder-gray-600 transition-all"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="flex-1 py-2.5 px-4 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 font-semibold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Return Home
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs shadow-lg shadow-purple-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Key className="w-4 h-4" /> Authenticate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
