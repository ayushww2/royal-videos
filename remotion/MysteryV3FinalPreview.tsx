import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import {productionPresetRegistry} from "./productionRegistry";
import {CINEMATIC_STAGE_THEMES, type CinematicStageThemeId} from "./selected/SelectedVisualPack";

const HOLD = 3.6;
const themes: CinematicStageThemeId[] = ["amber", "steel", "teal", "crimson"];

export const MYSTERY_V3_FINAL_PREVIEW_DURATION_SEC =
  HOLD * (1 + 1 + 1 + 1 + 1 + themes.length + 1 + 1); // LT + 5 slideshows + 4 cinematic + crystal + reveal

const Label: React.FC<{title: string}> = ({title}) => (
  <div
    style={{
      position: "absolute",
      top: 18,
      left: 28,
      zIndex: 40,
      padding: "10px 16px",
      background: "rgba(0,0,0,0.75)",
      color: "#ffd24a",
      fontFamily: "Inter, Arial, sans-serif",
      fontWeight: 800,
      fontSize: 28,
      pointerEvents: "none",
    }}
  >
    {title}
  </div>
);

export const MysteryV3FinalPreview: React.FC = () => {
  const {fps} = useVideoConfig();
  const hf = Math.round(HOLD * fps);
  const a = staticFile("overlays/transitions/preview-stills/a.png");
  const b = staticFile("overlays/transitions/preview-stills/b.png");
  const slides = [
    {src: a, caption: "Evidence frame one", focus: {x: 0.5, y: 0.48}},
    {src: b, caption: "Evidence frame two", focus: {x: 0.52, y: 0.45}},
  ];
  const per = Math.round(hf / 2) + 12;

  const LT = productionPresetRegistry["01_classic_blue_white_lower_third"];
  const Glass = productionPresetRegistry["04_glass_gallery_slideshow"];
  const Soft = productionPresetRegistry["24_soft_glass_focus_slideshow"];
  const Zoom = productionPresetRegistry["25_clean_zoom_frame_slideshow"];
  const Blur = productionPresetRegistry["26_minimal_blur_backdrop_slideshow"];
  const Stage = productionPresetRegistry["06_cinematic_stage_slideshow"];
  const Crystal = productionPresetRegistry["28_crystal_stage_slideshow"];
  const Reveal = productionPresetRegistry["08_reveal_question"];

  type Clip = {title: string; node: React.ReactNode};
  const clips: Clip[] = [
    {
      title: "#LT Classic Blue (2–3 words, text-fit)",
      node: (
        <>
          <AbsoluteFill>
            <Img src={a} style={{width: "100%", height: "100%", objectFit: "cover"}} />
          </AbsoluteFill>
          {LT ? (
            <LT
              primaryText="HIDDEN CHAMBER"
              durationFrames={hf}
              fillColor="#1A4297"
              position="bottom_left"
            />
          ) : null}
        </>
      ),
    },
    {
      title: "#5 Glass Gallery",
      node: Glass ? (
        <Glass slides={slides} durationPerSlide={per} defaultSlideFrames={per} transitionFrames={12} />
      ) : null,
    },
    {
      title: "#6 Soft Glass Focus",
      node: Soft ? (
        <Soft slides={slides} durationPerSlide={per} transitionFrames={12} />
      ) : null,
    },
    {
      title: "#7 Clean Zoom Frame",
      node: Zoom ? (
        <Zoom slides={slides} durationPerSlide={per} transitionFrames={12} />
      ) : null,
    },
    {
      title: "#8 Minimal Blur Backdrop",
      node: Blur ? (
        <Blur slides={slides} durationPerSlide={per} transitionFrames={12} />
      ) : null,
    },
    ...themes.map((theme) => ({
      title: `#11 Cinematic Stage — ${CINEMATIC_STAGE_THEMES[theme].label}`,
      node: Stage ? (
        <Stage
          slides={slides}
          defaultSlideFrames={per}
          transitionFrames={12}
          theme={theme}
        />
      ) : null,
    })),
    {
      title: "#12 Crystal Stage",
      node: Crystal ? (
        <Crystal slides={slides} durationPerSlide={per} transitionFrames={12} />
      ) : null,
    },
    {
      title: "#16 Question Reveal (Jesus style)",
      node: Reveal ? (
        <Reveal
          question="WHAT DID THEY HIDE?"
          backgroundImage={a}
          durationFrames={hf}
        />
      ) : null,
    },
  ];

  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      {clips.map((c, i) => (
        <Sequence key={i} from={i * hf} durationInFrames={hf} layout="none">
          <AbsoluteFill style={{backgroundColor: "#000"}}>
            {c.node}
            <Label title={c.title} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
