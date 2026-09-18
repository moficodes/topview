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
  onDragEnd?: () => void;
  isReadOnly?: boolean;
}

export const InteractiveCanvas: React.FC<InteractiveCanvasProps> = ({
  imgUrl,
  x,
  y,
  scale,
  onChange,
  onDragEnd,
  isReadOnly = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [prevImgUrl, setPrevImgUrl] = useState(imgUrl);
  if (imgUrl !== prevImgUrl) {
    setPrevImgUrl(imgUrl);
    setImgError(false);
  }

  const dragStart = useRef({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Active pointers map (pointerId -> { x, y })
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);

  // Keep latest props in a ref for callbacks
  const propsRef = useRef({ x, y, scale });
  useEffect(() => {
    propsRef.current = { x, y, scale };
  }, [x, y, scale]);

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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isReadOnly || !onChange) return;
    // Only drag on primary button for mouse
    if (e.pointerType === "mouse" && e.button !== 0) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if setPointerCapture is unsupported
    }

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX - propsRef.current.x * containerSize.width,
        y: e.clientY - propsRef.current.y * containerSize.height,
      };
    } else if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      pinchStartDistanceRef.current = dist > 0 ? dist : 1;
      pinchStartScaleRef.current = propsRef.current.scale;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isReadOnly || !onChange || containerSize.width === 0 || containerSize.height === 0) return;
    if (!pointersRef.current.has(e.pointerId)) return;

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      // Single pointer: Pan (drag)
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      onChange({
        x: dx / containerSize.width,
        y: dy / containerSize.height,
        scale: propsRef.current.scale,
      });
    } else if (pointersRef.current.size === 2) {
      // Two pointers: Pinch-to-zoom
      const points = Array.from(pointersRef.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const currentDistance = Math.hypot(p1.x - p2.x, p1.y - p2.y);

      if (pinchStartDistanceRef.current && pinchStartDistanceRef.current > 0) {
        const factor = currentDistance / pinchStartDistanceRef.current;
        const newScale = Math.max(0.1, Math.min(15.0, pinchStartScaleRef.current * factor));
        onChange({
          x: propsRef.current.x,
          y: propsRef.current.y,
          scale: newScale,
        });
      }
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 1) {
      // Seamless transition back to single pointer drag
      const [remaining] = Array.from(pointersRef.current.values());
      dragStart.current = {
        x: remaining.x - propsRef.current.x * containerSize.width,
        y: remaining.y - propsRef.current.y * containerSize.height,
      };
      pinchStartDistanceRef.current = null;
    } else if (pointersRef.current.size === 0) {
      setIsDragging(false);
      pinchStartDistanceRef.current = null;
      if (onDragEnd) {
        onDragEnd();
      }
    }
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      setIsDragging(false);
      pinchStartDistanceRef.current = null;
      if (onDragEnd) {
        onDragEnd();
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isReadOnly || !onChange) return;
    e.preventDefault();

    const zoomFactor = 0.05;
    const direction = e.deltaY < 0 ? 1 : -1;
    const currentScale = propsRef.current.scale;
    const newScale = Math.max(0.1, Math.min(15.0, currentScale + direction * zoomFactor * currentScale));

    onChange({
      x: propsRef.current.x,
      y: propsRef.current.y,
      scale: newScale,
    });
  };

  // Convert normalized X and Y back to pixels
  const pxX = x * containerSize.width;
  const pxY = y * containerSize.height;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-[#1e2029] border border-gray-800 rounded-xl flex items-center justify-center select-none touch-none ${
        isReadOnly ? "" : isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onWheel={handleWheel}
    >
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

      {imgUrl && !imgError ? (
        <img
          src={imgUrl}
          alt="Room Content"
          onError={() => setImgError(true)}
          className="max-w-[80%] max-h-[80%] object-contain pointer-events-none transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pxX}px, ${pxY}px) scale(${scale})`,
          }}
        />
      ) : imgError ? (
        <div className="text-gray-400 text-center flex flex-col items-center gap-2 pointer-events-none p-4">
          <svg
            className="w-12 h-12 text-red-400/80 mb-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span className="text-sm font-medium text-red-300">Failed to load image</span>
          <span className="text-[11px] text-gray-500 max-w-xs truncate font-mono">
            {imgUrl}
          </span>
        </div>
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
      {!isReadOnly && imgUrl && !imgError && (
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
