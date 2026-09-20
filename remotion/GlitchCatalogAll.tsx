import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const STILLS = [
  "overlays/transitions/preview-stills/cave.png",
  "overlays/transitions/preview-stills/a.png",
  "overlays/transitions/preview-stills/b.png",
  "overlays/transitions/preview-stills/c.png",
] as const;

export type GlitchDemo = {
  id: string;
  file: string;
  name: string;
  status: "approved" | "rejected";
  note: string;
};

/** All Remotion glitch overlays under public/overlays/glitch. */
export const GLITCH_DEMOS: GlitchDemo[] = [
  {
    id: "glitch_scan_a",
    file: "overlays/glitch/glitch_scan_a.mp4",
    name: "Glitch Scan A",
    status: "approved",
    note: "Blue scan-band flash · cut accent",
  },
  {
    id: "glitch_scan_b",
    file: "overlays/glitch/glitch_scan_b.mp4",
    name: "Glitch Scan B",
    status: "approved",
    note: "Cyan band + white bar",
  },
  {
    id: "glitch_line_burst",
    file: "overlays/glitch/glitch_line_burst.mp4",
    name: "Glitch Line Burst",
    status: "approved",
    note: "Subtle cyan lines · best screen overlay",
  },
  {
    id: "glitch_static",
    file: "overlays/glitch/glitch_static.mp4",
    name: "Glitch Static",
    status: "approved",
    note: "Full-frame snow · rare high-impact",
  },
  {
    id: "glitch_block_slice",
    file: "overlays/glitch/glitch_block_slice.mp4",
    name: "Glitch Block Slice",
    status: "approved",
    note: "Digital block slice + vertical lines",
  },
  {
    id: "glitch_next_card",
    file: "overlays/glitch/glitch_next_card.mp4",
    name: "Glitch NEXT Card",
    status: "rejected",
    note: "Baked-in NEXT text — meme/title card",
  },
  {
    id: "glitch_rf_card",
    file: "overlays/glitch/glitch_rf_card.mp4",
    name: "Glitch RF Card",
    status: "rejected",
    note: "Baked-in RF lettering",
  },
  {
    id: "glitch_noref_card",
    file: "overlays/glitch/glitch_noref_card.mp4",
    name: "Glitch NO REF Card",
    status: "rejected",
    note: "Baked-in NO REF text",
  },
  {
    id: "glitch_error_signal",
    file: "overlays/glitch/glitch_error_signal.mp4",
    name: "Glitch ERROR Signal",
    status: "rejected",
    note: "Baked-in ERROR-SIGNAL text",
  },
];

function DarkenVeil({
  durationInFrames,
  amount,
}: {
  durationInFrames: number;
  amount: number;
}) {
  const frame = useCurrentFrame();
  const fade = Math.max(1, Math.round(durationInFrames * 0.25));
  const opacity = interpolate(
    frame,
    [0, fade, Math.max(fade + 1, durationInFrames - fade), Math.max(1, durationInFrames - 1)],
    [0, amount, amount, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity, pointerEvents: "none" }} />
  );
}

export type GlitchCatalogAllProps = {
  holdSec?: number;
  overlaySec?: number;
};

/**
 * Remotion-only catalog of every glitch overlay MP4, named on screen,
 * played screen-blend over stills (same path DocumentaryEdit uses).
 */
export const GlitchCatalogAll: React.FC<GlitchCatalogAllProps> = ({
  holdSec = 2.4,
  overlaySec = 0.9,
}) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const overlayFrames = Math.max(1, Math.round(overlaySec * fps));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {GLITCH_DEMOS.map((demo, i) => {
        const still = STILLS[i % STILLS.length];
        const overlayFrom = i * holdFrames + Math.floor((holdFrames - overlayFrames) / 2);
        const badge = demo.status === "approved" ? "#8ff0a4" : "#ff6b6b";
        return (
          <React.Fragment key={demo.id}>
            <Sequence from={i * holdFrames} durationInFrames={holdFrames}>
              <AbsoluteFill>
                <Img
                  src={staticFile(still)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    padding: "22px 40px",
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0) 100%)",
                    zIndex: 10,
                    pointerEvents: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                    <span
                      style={{
                        fontFamily: "Inter, Arial, sans-serif",
                        fontSize: 30,
                        fontWeight: 800,
                        color: "#ffd24a",
                      }}
                    >
                      {i + 1}/{GLITCH_DEMOS.length}
                    </span>
                    <span
                      style={{
                        fontFamily: "Inter, Arial, sans-serif",
                        fontSize: 42,
                        fontWeight: 800,
                        color: "#fff",
                      }}
                    >
                      {demo.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "Inter, Arial, sans-serif",
                        fontSize: 22,
                        fontWeight: 800,
                        color: badge,
                        letterSpacing: 2,
                        marginLeft: 8,
                      }}
                    >
                      {demo.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    position: "absolute",
                    bottom: 28,
                    left: 40,
                    padding: "12px 22px",
                    background: "rgba(0,0,0,0.85)",
                    borderLeft: `6px solid ${badge}`,
                    zIndex: 10,
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "Consolas, monospace",
                      fontSize: 26,
                      color: "#8ff0a4",
                    }}
                  >
                    {demo.id}
                  </div>
                  <div
                    style={{
                      fontFamily: "Inter, Arial, sans-serif",
                      fontSize: 22,
                      color: "#c9d4e4",
                      marginTop: 4,
                    }}
                  >
                    {demo.note}
                  </div>
                </div>
              </AbsoluteFill>
            </Sequence>
            <Sequence from={overlayFrom} durationInFrames={overlayFrames}>
              <DarkenVeil durationInFrames={overlayFrames} amount={0.35} />
              <AbsoluteFill style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
                <OffthreadVideo
                  src={staticFile(demo.file)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  volume={0.25}
                  muted={false}
                />
              </AbsoluteFill>
            </Sequence>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

export const GLITCH_CATALOG_COUNT = GLITCH_DEMOS.length;
