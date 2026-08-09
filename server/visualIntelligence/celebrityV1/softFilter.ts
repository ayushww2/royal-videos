/**
 * Celebrity v1 soft filter: keep the pool alive, but hard-reject Google/Pexels
 * stills that do not name the celebrity (or a beat exact person) in title/caption/URL.
 * Raw footage and uploaded assets pass through content-safety only.
 */
import { jobDataFile, writeJson } from "../../storage.js";
import type {
  TitleLock,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";
import { isAllowedHorizontalAspect } from "../aspectPolicy.js";
import { isRawFootageSource } from "../../rawFootage/youtubeRawCandidates.js";
import {
  assessContentSafety,
  isStopwordSubject,
  textMentionsPerson,
} from "../contentSafety.js";

const STOCK_JUNK = [
  "gettyimages",
  "alamy",
  "shutterstock",
  "istockphoto",
  "dreamstime",
  "depositphotos",
  "youtube thumbnail",
  "meme",
  "clickbait",
];

function beatNeedsPerson(beat: VisualBeat | undefined, titleLock: TitleLock): boolean {
  if (!beat) return Boolean(titleLock.mainSubject);
  if (beat.visualRole === "main_subject" || beat.beatType === "exact_person") return true;
  const exact = (beat.exactSubject || beat.mustMatchEntity || "").trim();
  if (exact && !isStopwordSubject(exact)) return true;
  if ((beat.mentionedPeople || []).length > 0) return true;
  return false;
}

function personTargetsForCandidate(
  c: VisualCandidate,
  beats: VisualBeat[],
  titleLock: TitleLock
): string[] {
  const names = new Set<string>();
  if (titleLock.mainSubject) names.add(titleLock.mainSubject);
  for (const id of c.relatedBeatIds || []) {
    const beat = beats.find((b) => b.beatId === id);
    if (!beat) continue;
    if (beat.exactSubject && !isStopwordSubject(beat.exactSubject)) names.add(beat.exactSubject);
    if (beat.mustMatchEntity && !isStopwordSubject(beat.mustMatchEntity)) {
      names.add(beat.mustMatchEntity);
    }
    for (const p of beat.mentionedPeople || []) {
      if (p && !isStopwordSubject(p)) names.add(p);
    }
  }
  if (c.relatedEntities?.length) {
    for (const e of c.relatedEntities) {
      if (e && !isStopwordSubject(e) && e.split(/\s+/).length >= 2) names.add(e);
    }
  }
  return [...names];
}

function hasNameOrFaceEvidence(c: VisualCandidate, personNames: string[]): boolean {
  if (!personNames.length) return true;
  const parts = [
    c.title,
    c.snippet,
    c.queryUsed,
    c.sourcePageUrl,
    c.urlOrPath,
    ...(c.relatedEntities || []),
  ];
  // Face / entity tags from collector land in relatedEntities; captions in title.
  return personNames.some((name) => textMentionsPerson(name, parts));
}

export async function celebritySoftFilter(params: {
  jobId: string;
  candidates: VisualCandidate[];
  beats: VisualBeat[];
  titleLock: TitleLock;
}): Promise<{ kept: VisualCandidate[]; rejected: VisualCandidate[] }> {
  const { jobId, candidates, beats, titleLock } = params;
  const kept: VisualCandidate[] = [];
  const rejected: VisualCandidate[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const reasons: string[] = [];
    const url = (c.urlOrPath || "").toLowerCase();
    const title = (c.title || "").toLowerCase();
    const page = (c.sourcePageUrl || "").toLowerCase();
    const hay = `${url} ${title} ${page}`;

    if (!c.urlOrPath) reasons.push("broken URL/file");
    const dedupeKey = isRawFootageSource(c.source) ? `raw:${c.candidateId}` : url;
    if (seen.has(dedupeKey)) reasons.push("duplicate");

    // Person/name evidence first — named Getty/Alamy press stills are the archival look.
    const relatedBeats = (c.relatedBeatIds || [])
      .map((id) => beats.find((b) => b.beatId === id))
      .filter(Boolean) as VisualBeat[];
    const personIntent =
      relatedBeats.some((b) => beatNeedsPerson(b, titleLock)) ||
      (!relatedBeats.length && Boolean(titleLock.mainSubject));
    const webStill =
      c.source === "google_image" ||
      c.source === "pexels_image" ||
      c.source === "pixabay_image" ||
      c.source === "brave_image";
    const targets = personTargetsForCandidate(c, beats, titleLock);
    const named = hasNameOrFaceEvidence(c, targets);

    const memeJunk = ["youtube thumbnail", "meme", "clickbait"];
    if (memeJunk.some((h) => hay.includes(h))) {
      reasons.push("meme / thumbnail junk");
    }
    // Only ban stock HOSTS when the still is unnamed (wrong-person stock risk).
    const stockHosts = [
      "gettyimages",
      "alamy",
      "shutterstock",
      "istockphoto",
      "dreamstime",
      "depositphotos",
    ];
    if (!named && stockHosts.some((h) => hay.includes(h))) {
      reasons.push("unnamed stock host");
    }

    if (!isRawFootageSource(c.source) && (url.includes("ytimg.com") || title.includes("youtube"))) {
      reasons.push("YouTube thumbnail");
    }

    const safety = assessContentSafety({
      title: c.title,
      url: c.urlOrPath,
      pageUrl: c.sourcePageUrl,
      query: c.queryUsed,
    });
    if (safety.unsafe) {
      reasons.push(...safety.reasons.map((r) => `content_safety: ${r}`));
    }

    const aspect = isAllowedHorizontalAspect(c.dimensions);
    const isLocal = isRawFootageSource(c.source) || c.source === "uploaded_asset";
    if (!aspect.ok) {
      // Celebrity: keep named stills even when SearchAPI omits dimensions.
      if (!(isLocal && aspect.reason?.includes("missing dimensions")) && !(named && aspect.reason?.includes("missing"))) {
        reasons.push(aspect.reason || "aspect not horizontal 16:9 or 4:3");
      }
    } else if (c.dimensions && (c.dimensions.width < 400 || c.dimensions.height < 300)) {
      reasons.push("too small");
    }

    if (personIntent && webStill && !isRawFootageSource(c.source) && !named) {
      reasons.push(
        `celebrity name lock: no name/face evidence for ${targets[0] || titleLock.mainSubject}`
      );
    }

    // Ban stopword-only subjects masquerading as exact person hits.
    const q = (c.queryUsed || "").trim();
    if (q && isStopwordSubject(q)) {
      reasons.push("stopword subject query");
    }

    if (reasons.length) {
      rejected.push({ ...c, rejected: true, rejectReason: reasons.join("; ") });
      continue;
    }
    seen.add(dedupeKey);
    kept.push(c);
  }

  await writeJson(jobDataFile("celebrity-v1-soft-filter", jobId), {
    jobId,
    mainSubject: titleLock.mainSubject,
    keptCount: kept.length,
    rejectedCount: rejected.length,
    kept,
    rejected: rejected.slice(0, 80),
  });

  return { kept, rejected };
}
