import React, { useRef, useState, useEffect } from "react";

interface CanvasState {
  x: number;
  y: number;
  scale: number;
}

interface InteractiveCanvasProps {
  imgUrl: string;
  x: number;
  y: number;
  scale: number;
  onChange?: (state: CanvasState) => void;
  isReadOnly?: boolean;
}

export const InteractiveCanvas: React.FC<InteractiveCanvasProps> = ({
  imgUrl,
  x,
  y,
  scale,
  onChange,
  isReadOnly = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Update container size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);

    // Create a ResizeObserver to catch container size changes (like layout changes)
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateSize);
      observer.disconnect();
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isReadOnly || !onChange) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - x * containerSize.width,
      y: e.clientY - y * containerSize.height,
    };
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || isReadOnly || !onChange || containerSize.width === 0) return;
    
    // Calculate new normalized translation
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    
    onChange({
      x: dx / containerSize.width,
      y: dy / containerSize.height,
      scale,
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isReadOnly || !onChange) return;
    e.preventDefault();
    
    const zoomFactor = 0.05;
    const direction = e.deltaY < 0 ? 1 : -1;
    const newScale = Math.max(0.1, Math.min(15, scale + direction * zoomFactor * scale));
    
    onChange({
      x,
      y,
      scale: newScale,
    });
  };

  // Touch support for mobile admin control
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isReadOnly || !onChange || e.touches.length !== 1) return;
    setIsDragging(true);
    const touch = e.touches[0];
    dragStart.current = {
      x: touch.clientX - x * containerSize.width,
      y: touch.clientY - y * containerSize.height,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || isReadOnly || !onChange || containerSize.width === 0 || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStart.current.x;
    const dy = touch.clientY - dragStart.current.y;
    
    onChange({
      x: dx / containerSize.width,
      y: dy / containerSize.height,
      scale,
    });
  };

  // Convert normalized X and Y back to pixels
  const pxX = x * containerSize.width;
  const pxY = y * containerSize.height;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-[#1e2029] border border-gray-800 rounded-xl flex items-center justify-center select-none ${
        isReadOnly ? "" : isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUpOrLeave}
    >
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

      {imgUrl ? (
        <img
          src={imgUrl.startsWith("http") || imgUrl.startsWith("/") ? imgUrl : imgUrl}
          alt="Room Content"
          className="max-w-[80%] max-h-[80%] object-contain pointer-events-none transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pxX}px, ${pxY}px) scale(${scale})`,
          }}
        />
      ) : (
        <div className="text-gray-500 text-center flex flex-col items-center gap-2 pointer-events-none">
          <svg
            className="w-12 h-12 text-gray-600 animate-pulse"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-sm font-medium">No Content Uploaded Yet</span>
        </div>
      )}

      {/* Info indicator for admins */}
      {!isReadOnly && imgUrl && (
        <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-xs text-gray-400 py-1 px-2.5 rounded-full pointer-events-none flex gap-2">
          <span>Scale: {scale.toFixed(2)}x</span>
          <span className="border-l border-gray-700 pl-2">
            Pos: {pxX.toFixed(0)}, {pxY.toFixed(0)}
          </span>
        </div>
      )}
    </div>
  );
};
