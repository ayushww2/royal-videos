/**
 * 7s cinematic intro plan for every Mystery v2 film.
 * Hook lines from title + first still URLs from the timeline.
 */
import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import type { TimelineScene } from "../../../shared/visualIntelligence.js";

export type MysteryIntroShot = {
  src: string;
  line1: string;
  line2?: string;
  motion: "in" | "out";
  overlay?: string;
};

export type MysteryIntroPlan = {
  enabled: true;
  durationSec: 7;
  musicVolume: number;
  shots: MysteryIntroShot[];
};

const OVERLAYS = [
  undefined,
  "overlays/transitions/film-burn.mp4",
  "overlays/transitions/transition-glitch.mp4",
  "overlays/transitions/camera-shutter.mp4",
  "overlays/transitions/light-film-burn.mp4",
  "overlays/transitions/rgb-glitch-effect.mp4",
  "overlays/transitions/double-camera-film-burn.mp4",
];

function heuristicLines(title: string): Array<{ line1: string; line2?: string }> {
  const t = title.replace(/[—–-]/g, " ").trim();
  const parts = t.split(/\s+/);
  const a = parts.slice(0, Math.min(4, parts.length)).join(" ").toUpperCase();
  const b = parts.slice(4, 8).join(" ").toUpperCase();
  return [
    { line1: a || "THE STORY", line2: "BEGINS" },
    { line1: "THEY WERE", line2: "PROTECTED" },
    { line1: "THEN THE", line2: "RULES CHANGED" },
    { line1: "OLD FEARS", line2: "RETURNED" },
    { line1: "A MASSIVE", line2: "HUNT BEGAN" },
    { line1: "WHAT WENT", line2: "WRONG?" },
    { line1: b || "THE COST", line2: "OF SUCCESS" },
  ];
}

export async function buildMysteryIntroPlan(params: {
  jobId: string;
  title: string;
  scenes: TimelineScene[];
  libraryUrls: Map<string, string>;
}): Promise<MysteryIntroPlan> {
  const urls: string[] = [];
  for (const s of params.scenes) {
    const u =
      params.libraryUrls.get(s.approvedVisualId || s.selectedVisualId || "") ||
      s.previewUrl;
    if (u && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
    if (urls.length >= 7) break;
  }
  while (urls.length < 7 && urls.length > 0) urls.push(urls[urls.length % urls.length]);

  let lines = heuristicLines(params.title);
  try {
    const result = await chatJson<{
      shots: Array<{ line1: string; line2?: string }>;
    }>({
      system: `Write a 7-beat cinematic YouTube hook for a Mystery documentary intro.
Each beat is 1 second. Impact/trailer voice. ALL CAPS short lines (2–4 words each line).
Return JSON { shots: [{ line1, line2? }] } with EXACTLY 7 shots.
Escalate tension. Last shot can be the question/hook.`,
      user: JSON.stringify({ title: params.title }),
      temperature: 0.4,
    });
    if (result.shots?.length >= 7) {
      lines = result.shots.slice(0, 7).map((s) => ({
        line1: String(s.line1 || "").toUpperCase().slice(0, 28),
        line2: s.line2 ? String(s.line2).toUpperCase().slice(0, 28) : undefined,
      }));
    }
  } catch (err) {
    console.warn(
      `[mysteryV2/intro] hook lines fallback for ${params.jobId}:`,
      err instanceof Error ? err.message : err
    );
  }

  const shots: MysteryIntroShot[] = lines.map((line, i) => ({
    src: urls[i] || urls[0] || "",
    line1: line.line1,
    line2: line.line2,
    motion: i % 2 === 0 ? "in" : "out",
    overlay: OVERLAYS[i],
  })).filter((s) => s.src);

  const plan: MysteryIntroPlan = {
    enabled: true,
    durationSec: 7,
    musicVolume: 0.85,
    shots,
  };
  await writeJson(jobDataFile("mystery-v2-intro-plan", params.jobId), {
    jobId: params.jobId,
    ...plan,
    createdAt: new Date().toISOString(),
  });
  return plan;
}
