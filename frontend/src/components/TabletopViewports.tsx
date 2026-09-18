import React from "react";
import { InteractiveCanvas } from "./InteractiveCanvas";

export interface TabletopViewportsProps {
  imgUrl: string;
  x: number;
  y: number;
  scale: number;
  layout: string;
  aspectRatio: string;
  containerWidth: number;
  containerHeight: number;
  isMini?: boolean;
}

export const TabletopViewports: React.FC<TabletopViewportsProps> = ({
  imgUrl,
  x,
  y,
  scale,
  layout,
  aspectRatio = "16:9",
  containerWidth,
  containerHeight,
  isMini = false,
}) => {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }

  const gap = isMini ? 4 : 16;
  const [rw, rh] = (aspectRatio || "16:9").split(":").map(Number);
  const aspect = rw && rh ? rw / rh : 16 / 9;

  const calculateViewportSize = (availW: number, availH: number) => {
    if (availW <= 0 || availH <= 0) return { width: 0, height: 0 };
    if (availW / availH > aspect) {
      return { width: availH * aspect, height: availH };
    }
    return { width: availW, height: availW / aspect };
  };

  let viewW = 0;
  let viewH = 0;
  let sideW = 0;
  let sideH = 0;

  if (layout === "1") {
    const { width, height } = calculateViewportSize(containerWidth, containerHeight);
    viewW = width;
    viewH = height;
  } else if (layout === "2-tb") {
    const { width, height } = calculateViewportSize(containerWidth, (containerHeight - gap) / 2);
    viewW = width;
    viewH = height;
  } else if (layout === "2-lr") {
    const slotW = (containerWidth - gap) / 2;
    const slotH = containerHeight;
    const invAspect = 1 / aspect;
    const { wVis, hVis } =
      slotW / slotH > invAspect
        ? { wVis: slotH * invAspect, hVis: slotH }
        : { wVis: slotW, hVis: slotW / invAspect };
    viewW = hVis;
    viewH = wVis;
  } else if (layout === "3-trb" || layout === "3-tlb") {
    const hWidthLimit = (containerWidth - gap) / (1 + aspect);
    const hHeightLimit = (containerHeight - gap) / 2;
    const h = Math.min(hWidthLimit, hHeightLimit);
    viewH = h;
    viewW = h * aspect;
    sideW = 2 * h + gap;
    sideH = h;
  } else if (layout === "4") {
    const hWidthLimit = (containerWidth - 2 * gap) / (2 + aspect);
    const hHeightLimit = (containerHeight - gap) / 2;
    const h = Math.min(hWidthLimit, hHeightLimit);
    viewH = h;
    viewW = h * aspect;
    sideW = 2 * h + gap;
    sideH = h;
  }

  const viewportClass = isMini
    ? "bg-[#111219] rounded-md overflow-hidden border border-gray-800 relative shadow-sm"
    : "bg-[#111219] rounded-2xl overflow-hidden shadow-2xl border border-gray-900 relative";

  const badgeClass = isMini
    ? "absolute bottom-1 left-1 bg-black/75 border border-gray-800/80 px-1 py-0.2 rounded text-[7px] font-mono text-gray-400 select-none pointer-events-none"
    : "absolute bottom-3 left-3 bg-black/60 border border-gray-900/60 px-2 py-0.5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest select-none pointer-events-none";

  const renderScreen = (
    w: number,
    h: number,
    rotateStyle: React.CSSProperties = {},
    label = "",
    extraStyle: React.CSSProperties = {}
  ) => (
    <div
      style={{
        width: `${w}px`,
        height: `${h}px`,
        ...rotateStyle,
        ...extraStyle,
      }}
      className={viewportClass}
    >
      <InteractiveCanvas imgUrl={imgUrl} x={x} y={y} scale={scale} isReadOnly />
      {label && <span className={badgeClass}>{label}</span>}
    </div>
  );

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      {layout === "1" && renderScreen(viewW, viewH, {}, isMini ? "0°" : "")}

      {layout === "2-tb" && (
        <div
          className="flex flex-col items-center justify-center w-full h-full"
          style={{ gap: `${gap}px` }}
        >
          {renderScreen(
            viewW,
            viewH,
            { transform: "rotate(180deg)" },
            isMini ? "Top (180°)" : "Top Screen (180°)"
          )}
          {renderScreen(viewW, viewH, {}, isMini ? "Bottom (0°)" : "Bottom Screen (0°)")}
        </div>
      )}

      {layout === "2-lr" && (
        <div
          className="flex items-center justify-center w-full h-full"
          style={{ gap: `${gap}px` }}
        >
          <div
            style={{ width: `${viewH}px`, height: `${viewW}px` }}
            className="flex items-center justify-center relative"
          >
            {renderScreen(
              viewW,
              viewH,
              { transform: "rotate(90deg)" },
              isMini ? "Left (90°)" : "Left Side (90°)",
              { position: "absolute" }
            )}
          </div>
          <div
            style={{ width: `${viewH}px`, height: `${viewW}px` }}
            className="flex items-center justify-center relative"
          >
            {renderScreen(
              viewW,
              viewH,
              { transform: "rotate(-90deg)" },
              isMini ? "Right (270°)" : "Right Side (270°)",
              { position: "absolute" }
            )}
          </div>
        </div>
      )}

      {layout === "3-trb" && (
        <div
          className="flex items-center justify-center w-full h-full"
          style={{ gap: `${gap}px` }}
        >
          <div
            className="flex flex-col items-center justify-center"
            style={{ gap: `${gap}px` }}
          >
            {renderScreen(
              viewW,
              viewH,
              { transform: "rotate(180deg)" },
              isMini ? "North (180°)" : "North (180°)"
            )}
            {renderScreen(viewW, viewH, {}, isMini ? "South (0°)" : "South (0°)")}
          </div>
          <div
            style={{ width: `${sideH}px`, height: `${sideW}px` }}
            className="flex items-center justify-center relative"
          >
            {renderScreen(
              sideW,
              sideH,
              { transform: "rotate(-90deg)" },
              isMini ? "East (270°)" : "East (270°)",
              { position: "absolute" }
            )}
          </div>
        </div>
      )}

      {layout === "3-tlb" && (
        <div
          className="flex items-center justify-center w-full h-full"
          style={{ gap: `${gap}px` }}
        >
          <div
            style={{ width: `${sideH}px`, height: `${sideW}px` }}
            className="flex items-center justify-center relative"
          >
            {renderScreen(
              sideW,
              sideH,
              { transform: "rotate(90deg)" },
              isMini ? "West (90°)" : "West (90°)",
              { position: "absolute" }
            )}
          </div>
          <div
            className="flex flex-col items-center justify-center"
            style={{ gap: `${gap}px` }}
          >
            {renderScreen(
              viewW,
              viewH,
              { transform: "rotate(180deg)" },
              isMini ? "North (180°)" : "North (180°)"
            )}
            {renderScreen(viewW, viewH, {}, isMini ? "South (0°)" : "South (0°)")}
          </div>
        </div>
      )}

      {layout === "4" && (
        <div
          className="flex items-center justify-center w-full h-full"
          style={{ gap: `${gap}px` }}
        >
          <div
            style={{ width: `${sideH}px`, height: `${sideW}px` }}
            className="flex items-center justify-center relative"
          >
            {renderScreen(
              sideW,
              sideH,
              { transform: "rotate(90deg)" },
              isMini ? "West (90°)" : "West (90°)",
              { position: "absolute" }
            )}
          </div>
          <div
            className="flex flex-col items-center justify-center"
            style={{ gap: `${gap}px` }}
          >
            {renderScreen(
              viewW,
              viewH,
              { transform: "rotate(180deg)" },
              isMini ? "North (180°)" : "North (180°)"
            )}
            {renderScreen(viewW, viewH, {}, isMini ? "South (0°)" : "South (0°)")}
          </div>
          <div
            style={{ width: `${sideH}px`, height: `${sideW}px` }}
            className="flex items-center justify-center relative"
          >
            {renderScreen(
              sideW,
              sideH,
              { transform: "rotate(-90deg)" },
              isMini ? "East (270°)" : "East (270°)",
              { position: "absolute" }
            )}
          </div>
        </div>
      )}
    </div>
  );
};
