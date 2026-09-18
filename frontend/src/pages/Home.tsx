import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Monitor, ShieldAlert, Plus, Users, ArrowRight, RefreshCw, Presentation } from "lucide-react";

interface RoomInfo {
  id: string;
  layout: string;
  imgUrl: string;
  clientCount: number;
}

export const Home: React.FC = () => {
  const [roomId, setRoomId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeRooms, setActiveRooms] = useState<RoomInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/rooms");
      if (res.ok) {
        const data = await res.json();
        setActiveRooms(data);
      }
    } catch (err) {
      console.error("Failed to fetch rooms:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch("/api/rooms");
        if (res.ok && mounted) {
          const data = await res.json();
          setActiveRooms(data);
        }
      } catch (err) {
        console.error("Failed to fetch rooms:", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim() || isSubmitting) return;
    const cleanId = roomId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!cleanId) return;

    setErrorMsg("");
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: cleanId }),
      });

      if (res.ok) {
        const data = await res.json();
        navigate(`/admin/${data.roomId}?key=${encodeURIComponent(data.adminKey)}`);
      } else if (res.status === 403) {
        setErrorMsg("This room is already claimed by another admin. Choose a different room ID.");
      } else {
        setErrorMsg("Failed to initialize room. Please try again.");
      }
    } catch (err) {
      console.error("Room creation error:", err);
      setErrorMsg("Network error connecting to server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinRoom = (id: string) => {
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (cleanId) {
      navigate(`/room/${cleanId}`);
    }
  };

  const generateRandomRoomId = () => {
    const adjectives = ["smart", "table", "cozy", "pixel", "round", "bright", "north", "south", "prime"];
    const nouns = ["hub", "view", "deck", "board", "space", "screen", "panel", "table", "room"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(100 + Math.random() * 900);
    setRoomId(`${adj}-${noun}-${num}`);
    if (errorMsg) setErrorMsg("");
  };

  return (
    <div className="min-h-screen bg-[#0d0e12] text-gray-200 flex flex-col justify-between p-4 md:p-8">
      {/* Header */}
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between py-4 border-b border-gray-900">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-purple-600/10 border border-purple-500/30 rounded-xl text-purple-400">
            <Presentation className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              TopView
            </h1>
            <p className="text-[10px] text-gray-500 font-mono">TABLETOP PRESENTATION HUB</p>
          </div>
        </div>
        <div className="text-xs text-gray-500 font-mono hidden sm:block">
          STATUS: ONLINE
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto w-full my-auto py-12 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Left column - Intro */}
        <div className="flex flex-col gap-6">
          <div className="inline-flex self-start items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs text-purple-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            Cooperative Presentation System
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
            Seamless multi-angle screen sharing.
          </h2>
          <p className="text-gray-400 text-base leading-relaxed">
            Designed for screens in the center of tables. Put your content on the admin panel, define up to 4 copy orientations, and let everybody around the table view it right side up in real-time.
          </p>
          <div className="flex flex-wrap gap-4 text-xs font-mono text-gray-500">
            <span className="flex items-center gap-1.5 bg-gray-950/40 px-2.5 py-1.5 rounded-lg border border-gray-900">
              <RefreshCw className="w-3.5 h-3.5" /> High Performance
            </span>
            <span className="flex items-center gap-1.5 bg-gray-950/40 px-2.5 py-1.5 rounded-lg border border-gray-900">
              <Users className="w-3.5 h-3.5" /> Zero Lag Sync
            </span>
          </div>
        </div>

        {/* Right column - Actions */}
        <div className="space-y-8 bg-[#13141c] p-6 md:p-8 rounded-2xl border border-gray-900/80 shadow-2xl">
          {/* Create / Enter Room form */}
          <form onSubmit={handleCreateRoom} className="space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-purple-400" /> Start or Join Room
            </h3>
            <div className="space-y-2">
              <label htmlFor="roomId" className="block text-xs font-medium text-gray-400">
                Room Identifier (alphanumeric, dashes, underscores)
              </label>
              <div className="flex gap-2">
                <input
                  id="roomId"
                  type="text"
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    if (errorMsg) setErrorMsg("");
                  }}
                  placeholder="e.g., table-alpha-101"
                  className="flex-1 px-4 py-2.5 bg-gray-950/80 border border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 text-sm placeholder-gray-600 transition-all font-mono"
                  required
                />
                <button
                  type="button"
                  onClick={generateRandomRoomId}
                  className="px-3 bg-gray-950 hover:bg-gray-900 text-gray-400 hover:text-white border border-gray-800 rounded-xl text-xs font-mono transition-all"
                  title="Generate dynamic room name"
                >
                  Random
                </button>
              </div>
              {errorMsg && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 p-2 rounded-lg">
                  {errorMsg}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting || !roomId.trim()}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs md:text-sm shadow-lg shadow-purple-600/20 transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ShieldAlert className="w-4 h-4" /> {isSubmitting ? "Connecting..." : "Admin Controls"}
              </button>
              <button
                type="button"
                onClick={() => roomId.trim() && handleJoinRoom(roomId)}
                disabled={isSubmitting || !roomId.trim()}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-gray-900 text-gray-200 font-semibold border border-gray-800 rounded-xl text-xs md:text-sm transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <Monitor className="w-4 h-4" /> Join Viewer
              </button>
            </div>
          </form>

          {/* Active Rooms */}
          <div className="space-y-4 pt-4 border-t border-gray-950">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold font-mono tracking-wider text-gray-500 uppercase flex items-center gap-1.5">
                Active Table Rooms
              </h4>
              <button
                onClick={handleRefresh}
                className="text-[10px] font-mono text-purple-400 hover:underline flex items-center gap-1"
                disabled={isLoading}
              >
                Refresh
              </button>
            </div>

            {activeRooms.length === 0 ? (
              <div className="text-center py-6 bg-gray-950/40 border border-dashed border-gray-900 rounded-xl text-gray-500 text-xs">
                No active rooms right now. Create one above to get started!
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {activeRooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex items-center justify-between p-3 bg-gray-950/80 border border-gray-900 rounded-xl hover:border-gray-800 transition-all group"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-gray-200 font-mono group-hover:text-purple-400 transition-colors">
                        {room.id}
                      </span>
                      <span className="text-[10px] text-gray-500 flex items-center gap-1">
                        Layout: <code className="px-1 py-0.2 bg-gray-900 text-gray-400 text-[9px] font-mono">{room.layout}</code>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 bg-gray-900/50 border border-gray-900 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                        <Users className="w-3 h-3 text-purple-500" /> {room.clientCount}
                      </span>
                      <button
                        onClick={() => handleJoinRoom(room.id)}
                        className="p-1.5 bg-purple-900/20 hover:bg-purple-900/40 border border-purple-500/20 rounded-lg text-purple-400 hover:text-purple-300 transition-all"
                        title="Join room"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto w-full text-center text-xs text-gray-600 border-t border-gray-950 py-4 mt-8">
        TopView Room Presenter • Designed for smart tabletop displays and shared presentation hubs.
      </footer>
    </div>
  );
};
