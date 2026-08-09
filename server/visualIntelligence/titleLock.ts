import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import type { JobRecord, TitleLock } from "../../shared/visualIntelligence.js";
import { isStopwordSubject } from "./contentSafety.js";

/** Pull a multi-word proper name from celebrity titles like "At 96, … Clint Eastwood …". */
export function extractCelebritySubjectFromTitle(title: string): string | null {
  const matches = [
    ...(title.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || []),
  ].map((m) => m[1].trim());
  const bad =
    /^(Dire Straits|Brothers In Arms|Live Aid|The Unseen|United States|New York|Los Angeles)$/i;
  for (const m of matches) {
    const first = m.split(/\s+/)[0] || "";
    if (isStopwordSubject(first) || bad.test(m)) continue;
    if (m.split(/\s+/).length >= 2) return m;
  }
  return null;
}

function localTitleLock(job: JobRecord): TitleLock {
  const title = job.title.trim();
  const words = title.replace(/[—–-]/g, " ").split(/\s+/).filter(Boolean);
  const celebrityName =
    job.niche === "Celebrity v1" ? extractCelebritySubjectFromTitle(title) : null;
  const mainSubject = celebrityName || words.slice(0, 8).join(" ") || title;
  const celebrityExpected = celebrityName
    ? [
        `${celebrityName} portrait`,
        `${celebrityName} interview`,
        `${celebrityName} archival`,
        "red carpet",
        "press photo",
        "stage performance",
        "premiere",
      ]
    : job.niche === "War v1"
      ? [
          "battle archival",
          "front line",
          "military equipment",
          "wartime map",
          "trenches",
          "aircraft wartime",
          "newsreel",
          "battlefield",
        ]
      : [
          "stone door",
          "wall",
          "scan",
          "chamber",
          "researchers",
          "maps",
          "evidence",
          "archaeology",
          "stone structure",
        ];
  return {
    jobId: job.jobId,
    title,
    mainSubject,
    centralObjectOrPlace: celebrityName || title,
    emotionalPromise:
      job.niche === "Celebrity v1"
        ? "biography / legacy"
        : job.niche === "War v1"
          ? "conflict / history"
          : "mystery / discovery",
    mysteryOrConflict: title,
    expectedVisuals: celebrityExpected,
    forbiddenDrift: ["random unrelated ruins", "meme graphics", "stock lifestyle", "wrong person"],
    createdAt: new Date().toISOString(),
  };
}

export async function createTitleLock(job: JobRecord): Promise<TitleLock> {
  try {
    const result = await chatJson<Omit<TitleLock, "jobId" | "title" | "createdAt">>({
      system: `You are a documentary video editor creating a Title Lock.
The Title Lock defines what the video is REALLY about so visuals never drift.
Return JSON with:
mainSubject, centralObjectOrPlace, emotionalPromise, mysteryOrConflict,
expectedVisuals (string[] of visual families viewer expects),
forbiddenDrift (string[] of loosely-related traps to avoid).
Think like an editor, not a keyword bot.`,
      user: JSON.stringify({ title: job.title, niche: job.niche, scriptPreview: job.script.slice(0, 4000) }),
    });

    const lock: TitleLock = {
      jobId: job.jobId,
      title: job.title,
      mainSubject: result.mainSubject || job.title,
      centralObjectOrPlace: result.centralObjectOrPlace || job.title,
      emotionalPromise: result.emotionalPromise || "documentary discovery",
      mysteryOrConflict: result.mysteryOrConflict || job.title,
      expectedVisuals: result.expectedVisuals || [],
      forbiddenDrift: result.forbiddenDrift || [],
      createdAt: new Date().toISOString(),
    };
    await writeJson(jobDataFile("title-lock", job.jobId), lock);
    return lock;
  } catch (err) {
    console.warn(`[titleLock] GPT failed for ${job.jobId}:`, err instanceof Error ? err.message : err);
    const lock = localTitleLock(job);
    await writeJson(jobDataFile("title-lock", job.jobId), { ...lock, fallback: true });
    return lock;
  }
}
