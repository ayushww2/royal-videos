/**
 * Soft repair: ONLY touch scenes that are clearly wrong / empty / needs_better.
 * Runs a single targeted Google search per broken scene and swaps if better.
 * Does not raise global strictness or re-run the whole pipeline.
 */
import { jobDataFile, writeJson } from "../../storage.js";
import { collectCandidates } from "../candidateCollection.js";
import { filterCandidates } from "../candidateFiltering.js";
import {
  assessContentSafety,
  textMentionsPerson,
} from "../contentSafety.js";
import { isRawFootageSource } from "../../rawFootage/youtubeRawCandidates.js";
import { celebrityRecipeActive } from "../celebrityV1/referenceRecipe.js";
import type {
  ApprovedVisual,
  JobRecord,
  QueryPack,
  TimelineScene,
  TitleLock,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";

function isBrokenScene(
  scene: TimelineScene,
  beat?: VisualBeat,
  opts?: { celebrity?: boolean; mainSubject?: string }
): boolean {
  if (!scene.approvedVisualId && !scene.selectedVisualId) return true;
  if (scene.matchType === "needs_better_visual" && !scene.approvedVisualId) return true;
  if ((scene.confidence || 0) < 0.45) return true;
  const wrong =
    (scene.confidenceScores?.wrongContextRisk ?? scene.confidenceScores?.wrongEntityRisk ?? 0) > 45;
  if (wrong) return true;
  const warnings = (scene.warnings || []).join(" ").toLowerCase();
  if (warnings.includes("wrong context") || warnings.includes("wrong entity") || warnings.includes("no visual")) {
    return true;
  }
  // Celebrity: only repair opener / person-lock failures — not every judge_fallback soft score.
  if (opts?.celebrity) {
    if (warnings.includes("celebrity opener") || warnings.includes("person-lock")) return true;
    if (scene.sceneId === "scene-1") {
      const hasName = textMentionsPerson(opts.mainSubject, [
        scene.whyThisMatchesNarration,
        scene.whyThisIsAppropriate,
        scene.reasonSelected,
        ...(scene.warnings || []),
      ]);
      if (!hasName && !scene.rawFootageUsed) return true;
    }
    return false;
  }
  if (scene.needsBetterVisual) return true;
  // Identity-critical beats with weak match
  if (
    beat &&
    (beat.visualRole === "main_subject" || beat.visualRole === "evidence") &&
    (beat.exactSubject || beat.mustMatchEntity) &&
    (scene.matchType === "related_context" || (scene.confidence || 0) < 0.55)
  ) {
    return true;
  }
  return false;
}

function scoreCandidateForBeat(c: VisualCandidate, beat: VisualBeat, titleLock: TitleLock): number {
  let score = 50;
  const hay = `${c.title || ""} ${c.snippet || ""} ${c.queryUsed || ""} ${(c.relatedEntities || []).join(" ")}`.toLowerCase();
  const exact = (beat.exactSubject || beat.mustMatchEntity || titleLock.mainSubject || "").toLowerCase();
  if (exact) {
    const parts = exact.split(/\s+/).filter((w) => w.length > 2);
    const hits = parts.filter((p) => hay.includes(p)).length;
    score += Math.min(40, hits * 12);
    if (hay.includes(exact)) score += 15;
  }
  if (titleLock.forbiddenDrift.some((d) => d && hay.includes(d.toLowerCase()))) score -= 30;
  if (isRawFootageSource(c.source)) score += beat.visualRole === "atmosphere" ? 10 : 2;
  if (c.rejected) score -= 50;
  // Celebrity person beats: name evidence is mandatory for web stills.
  const personBeat =
    beat.visualRole === "main_subject" ||
    beat.beatType === "exact_person" ||
    Boolean(beat.exactSubject);
  if (personBeat && !isRawFootageSource(c.source)) {
    const names = textMentionsPerson(titleLock.mainSubject, [
      c.title,
      c.snippet,
      c.queryUsed,
      c.urlOrPath,
      ...(c.relatedEntities || []),
    ]);
    if (!names) score -= 50;
    else score += 20;
  }
  return score;
}

function candidateToApproved(
  c: VisualCandidate,
  beat: VisualBeat,
  score: number,
  titleLock: TitleLock
): ApprovedVisual {
  const person =
    titleLock.mainSubject ||
    beat.exactSubject ||
    beat.mustMatchEntity ||
    (beat.mentionedPeople || [])[0] ||
    "";
  const people = [
    ...new Set(
      [person, ...(beat.mentionedPeople || [])].filter(Boolean).map((s) => String(s))
    ),
  ];
  return {
    approvedVisualId: `av-repair-${c.candidateId}`,
    source: c.source,
    filePathOrUrl: c.urlOrPath,
    thumbnail: c.thumbnail,
    matchedPeople: people,
    matchedCompanies: beat.mentionedCompanies || [],
    matchedPlaces: beat.mentionedPlaces || [],
    matchedEvents: beat.mentionedEvents || [],
    matchedDocuments: beat.mentionedDocuments || [],
    matchedObjects: beat.mentionedObjects || [],
    matchedScriptSubjects: [...new Set([...(c.relatedEntities || []), ...people])],
    allowedBeatIds: [beat.beatId],
    bestUseCase: `Soft repair for ${person || beat.viewerShouldSee || "beat"} — ${c.title || "named still"}`,
    confidenceScores: {
      entityMatch: Math.min(95, score),
      sceneMatch: Math.min(90, score - 5),
      topicRelevance: Math.min(90, score),
      eventPlaceYearRelevance: 70,
      visualQuality: 72,
      cropSafety16x9: 78,
      sourceReliability: 70,
      wrongEntityRisk: Math.max(5, 40 - score / 3),
      watermarkTextRisk: 10,
      reusePotential: 55,
      visualEditorScore: Math.min(88, score),
      titleSupportScore: Math.min(85, score - 4),
      narrationMatchScore: Math.min(85, score - 2),
      instantClarityScore: 72,
      horizontalUsability: 78,
      wrongContextRisk: Math.max(5, 35 - score / 3),
    },
    reuseLimit: 2,
    warnings: ["soft_repair"],
    candidateId: c.candidateId,
    queryPackId: c.queryPackId,
    mediaType: isRawFootageSource(c.source) ? "raw_footage" : "image",
    visualEditorScore: Math.min(88, score),
  };
}

/**
 * Repair only broken scenes. Caps work so a weak pool cannot explode cost.
 */
export async function softRepairBrokenScenes(params: {
  job: JobRecord;
  titleLock: TitleLock;
  beats: VisualBeat[];
  scenes: TimelineScene[];
  library: ApprovedVisual[];
  maxRepairs?: number;
}): Promise<{ scenes: TimelineScene[]; library: ApprovedVisual[]; repaired: number }> {
  const { job, titleLock, beats } = params;
  const maxRepairs = params.maxRepairs ?? 8;
  const scenes = params.scenes.map((s) => ({ ...s }));
  const library = [...params.library];
  const beatById = new Map(beats.map((b) => [b.beatId, b]));

  const celebrity = celebrityRecipeActive(job.niche);
  const broken = scenes
    .map((s, idx) => ({ s, idx, beat: beatById.get(s.beatId) }))
    .filter(({ s, beat }) =>
      isBrokenScene(s, beat, { celebrity, mainSubject: titleLock.mainSubject })
    )
    .slice(0, maxRepairs);

  if (!broken.length) {
    await writeJson(jobDataFile("soft-repair", job.jobId), {
      jobId: job.jobId,
      repaired: 0,
      note: "no broken scenes",
    });
    return { scenes, library, repaired: 0 };
  }

  let repaired = 0;
  const repairLog: Array<Record<string, unknown>> = [];
  const reuseCount = new Map<string, number>();
  for (const sc of scenes) {
    const id = sc.approvedVisualId || sc.selectedVisualId;
    if (id) reuseCount.set(id, (reuseCount.get(id) || 0) + 1);
  }

  for (const { s, idx, beat } of broken) {
    if (!beat) continue;
    // Never let stopword crumbs like "At" become the Google query.
    const subject =
      (titleLock.mainSubject && titleLock.mainSubject.trim()) ||
      (beat.exactSubject && !/^(at|the|a|an|so|and|of)\b/i.test(beat.exactSubject)
        ? beat.exactSubject
        : "") ||
      beat.mustMatchEntity ||
      job.title;
    const nicheHint =
      job.niche === "Celebrity v1"
        ? `${subject} interview archival portrait`
        : job.niche === "Space v1"
          ? `${subject} NASA space`
          : job.niche === "War v1"
            ? `${subject} wartime archival battle`
            : `${subject} documentary evidence photo`;

    const pack: QueryPack = {
      queryPackId: `repair-${s.sceneId}`,
      relatedBeatIds: [beat.beatId],
      entityContext: subject,
      query: nicheHint,
      sourceType: "google",
      expectedVisualType: "image",
      priority: 95,
      maxCandidates: 8,
      whyNeeded: `Soft repair wrong/weak scene ${s.sceneId}`,
      idealResultType: "horizontal documentary photo",
      forbiddenResultType: "meme, watermark collage, YouTube thumbnail text",
    };

    try {
      const { candidates } = await collectCandidates(job, [pack], [beat], []);
      const { kept } = await filterCandidates(job.jobId, candidates);
      const ranked = kept
        .map((c) => ({ c, score: scoreCandidateForBeat(c, beat, titleLock) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best || best.score < 58 || !best.c.urlOrPath) {
        repairLog.push({ sceneId: s.sceneId, ok: false, reason: "no better candidate" });
        continue;
      }

      const celebrity = celebrityRecipeActive(job.niche);
      const personBeat =
        beat.visualRole === "main_subject" ||
        beat.beatType === "exact_person" ||
        s.sceneId === "scene-1" ||
        Boolean(beat.exactSubject);
      if (
        celebrity &&
        personBeat &&
        !isRawFootageSource(best.c.source) &&
        !textMentionsPerson(titleLock.mainSubject, [
          best.c.title,
          best.c.snippet,
          best.c.queryUsed,
          best.c.urlOrPath,
          ...(best.c.relatedEntities || []),
        ])
      ) {
        repairLog.push({
          sceneId: s.sceneId,
          ok: false,
          reason: "celebrity name lock — repair candidate lacks name evidence",
        });
        continue;
      }

      const prevId =
        idx > 0
          ? scenes[idx - 1].approvedVisualId || scenes[idx - 1].selectedVisualId
          : undefined;

      // Prefer library alt first if it scores higher than current and repair candidate.
      const libAlt = library
        .filter((v) => v.approvedVisualId !== s.approvedVisualId && v.filePathOrUrl)
        .filter(
          (v) =>
            !(v.warnings || []).some((w) => /soft_failed/i.test(w)) &&
            !assessContentSafety({
              title: v.bestUseCase,
              url: v.filePathOrUrl,
              description: (v.matchedPeople || []).join(" "),
            }).unsafe &&
            (!celebrity || (reuseCount.get(v.approvedVisualId) || 0) < 2) &&
            (!celebrity || !prevId || v.approvedVisualId !== prevId)
        )
        .map((v) => {
          const fake: VisualCandidate = {
            candidateId: v.candidateId || v.approvedVisualId,
            source: v.source,
            urlOrPath: v.filePathOrUrl,
            title: v.bestUseCase,
            relatedEntities: v.matchedScriptSubjects || v.matchedPeople,
            relatedBeatIds: v.allowedBeatIds,
          };
          let score = scoreCandidateForBeat(fake, beat, titleLock);
          if (celebrity && (reuseCount.get(v.approvedVisualId) || 0) === 0) score += 15;
          return { v, score };
        })
        .sort((a, b) => b.score - a.score)[0];

      let chosenVisual: ApprovedVisual;
      let via: string;
      if (libAlt && libAlt.score >= best.score - 5 && libAlt.score >= 60) {
        chosenVisual = libAlt.v;
        via = "library";
      } else {
        chosenVisual = candidateToApproved(best.c, beat, best.score, titleLock);
        library.push(chosenVisual);
        via = "google_repair";
      }

      const oldId = s.approvedVisualId || s.selectedVisualId;
      if (oldId) reuseCount.set(oldId, Math.max(0, (reuseCount.get(oldId) || 1) - 1));
      reuseCount.set(
        chosenVisual.approvedVisualId,
        (reuseCount.get(chosenVisual.approvedVisualId) || 0) + 1
      );

      scenes[idx] = {
        ...scenes[idx],
        selectedVisualId: chosenVisual.approvedVisualId,
        approvedVisualId: chosenVisual.approvedVisualId,
        source: chosenVisual.source,
        reasonSelected: `Soft repair (${via}): better match for “${subject}”`,
        confidence: Math.min(0.92, Math.max(0.55, (chosenVisual.visualEditorScore || 70) / 100)),
        confidenceScores: chosenVisual.confidenceScores,
        needsBetterVisual: false,
        matchType: "good_context",
        warnings: [...new Set([...(scenes[idx].warnings || []).filter((w) => !w.includes("no visual")), "soft_repaired"])],
        whyThisIsAppropriate: `Repaired to match ${subject}`,
        whatIsMissing: "",
        rawFootageUsed: isRawFootageSource(chosenVisual.source),
      };
      repaired++;
      repairLog.push({ sceneId: s.sceneId, ok: true, via, subject, visualId: chosenVisual.approvedVisualId });
    } catch (err) {
      repairLog.push({
        sceneId: s.sceneId,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await writeJson(jobDataFile("soft-repair", job.jobId), {
    jobId: job.jobId,
    repaired,
    attempted: broken.length,
    repairLog,
  });
  await writeJson(jobDataFile("visual-intelligence-approved-library", job.jobId), {
    jobId: job.jobId,
    approved: library,
  });
  await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
    jobId: job.jobId,
    scenes,
  });

  return { scenes, library, repaired };
}
