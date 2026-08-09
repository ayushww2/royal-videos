/**
 * Internal Mystery v2 APIs: realism stills, Pexels stock, pack catalog.
 * Final job renders are RunPod / Remotion only — Shotstack pack render is disabled.
 */
import type { Express } from "express";
import path from "node:path";
import { generateMysteryRealismStill } from "./realismGenerate.js";
import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import { config, getPexelsKey } from "../../config.js";
import { searchPexelsImages, searchPixabayImages } from "../imageSearch.js";
import {
  loadAllMysteryPackTemplates,
  listMysteryPackTemplateFiles,
  MYSTERY_PACK_PRESETS,
} from "./packLoader.js";
import {
  MYSTERY_V2_FX_DENSITY,
  MYSTERY_V2_SHOTSTACK_EFFECTS,
  MYSTERY_V2_SHOTSTACK_FILTERS,
  MYSTERY_V2_SHOTSTACK_TRANSITIONS,
} from "./fxRecipe.js";
import { MYSTERY_V2_OVERLAYS, mysteryOverlayUrl } from "./overlayCatalog.js";
import { assembleMysteryTimeline } from "../mysteryV1/library.js";
import { runFinalQA } from "../finalQA.js";
import { persistMysteryV2Effects } from "./effectDensity.js";
import { buildMysteryIntroPlan } from "./introPlan.js";
import { renderJob } from "../../render/renderJob.js";
import type { ApprovedVisual, TitleLock, VisualBeat } from "../../../shared/visualIntelligence.js";

export function registerMysteryV2Routes(app: Express): void {
  /**
   * Re-assign scenes from existing beats + approved library (no recollect),
   * rebuild effects/intro, clear QA blocks, optionally queue RunPod render.
   */
  app.post("/api/jobs/:jobId/mystery-v2/reassemble", async (req, res) => {
    try {
      const job = await loadJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.niche !== "Mystery v2") {
        return res.status(400).json({ error: "Mystery v2 only" });
      }

      const beatsDoc = await readJson<{ beats: VisualBeat[] }>(
        jobDataFile("editor-visual-beats", job.jobId)
      );
      const libDoc = await readJson<{ approved?: ApprovedVisual[]; visuals?: ApprovedVisual[] }>(
        jobDataFile("visual-intelligence-approved-library", job.jobId)
      );
      const titleLock =
        (await readJson<TitleLock>(jobDataFile("title-lock", job.jobId))) ||
        ({ mainSubject: job.title } as TitleLock);
      const beats = beatsDoc?.beats || [];
      const library = libDoc?.approved || libDoc?.visuals || [];
      if (!beats.length || !library.length) {
        return res.status(400).json({
          error: "Missing beats or approved library — cannot reassemble",
          beats: beats.length,
          library: library.length,
        });
      }

      const scenes = await assembleMysteryTimeline(job.jobId, beats, library, titleLock);
      const missing = scenes.filter((s) => !s.approvedVisualId && !s.selectedVisualId).length;
      const libraryUrls = new Map<string, string>();
      for (const v of library) {
        if (v.filePathOrUrl) libraryUrls.set(v.approvedVisualId, v.filePathOrUrl);
      }

      const density = await persistMysteryV2Effects({
        jobId: job.jobId,
        title: job.title,
        scenes,
        beats,
        titleLock,
        libraryUrls,
      });
      const introPlan = await buildMysteryIntroPlan({
        jobId: job.jobId,
        title: job.title,
        scenes,
        libraryUrls,
      });

      const effectsByScene = new Map<string, typeof density.events>();
      for (const ev of density.events) {
        if (!ev.sceneId) continue;
        const list = effectsByScene.get(ev.sceneId) || [];
        list.push(ev);
        effectsByScene.set(ev.sceneId, list);
      }
      const scenesWithEffects = scenes.map((s) => ({
        ...s,
        effects: (effectsByScene.get(s.sceneId) || []).map((e) => ({
          id: e.id,
          presetId: e.presetId,
          reason: e.reason,
          durationFrames: e.durationFrames,
          startFrame: e.startFrame,
          props: e.props,
          blocksSubtitles: e.blocksSubtitles,
          tags: e.tags,
          renderProvider: "remotion" as const,
          renderable: true,
          simplified: false,
        })),
      }));

      await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
        jobId: job.jobId,
        scenes: scenesWithEffects,
        effectEvents: density.events,
        glitchEvents: density.glitchEvents,
        cinematicIntro: introPlan || undefined,
        reassembledAt: new Date().toISOString(),
      });
      await writeJson(jobDataFile("editor-final-scene-assignment", job.jobId), {
        jobId: job.jobId,
        scenes: scenesWithEffects,
      });

      const qa = await runFinalQA(job.jobId, scenesWithEffects);
      job.sceneApprovals = Object.fromEntries(
        scenesWithEffects.map((s) => [s.sceneId, "approved" as const])
      );
      job.error = undefined;
      job.status = "ready_for_scene_review";
      job.render = { status: "idle" };
      job.updatedAt = new Date().toISOString();
      await saveJob(job);

      // Soft-clear QA so auto/force render can proceed after emergency fill.
      if (!qa.canRender && missing === 0) {
        await writeJson(jobDataFile("visual-intelligence-final-qa", job.jobId), {
          ...qa,
          canRender: true,
          criticalIssues: [],
          warnings: [...(qa.warnings || []), "reassemble override: emergency library reuse"],
          overrideAt: new Date().toISOString(),
        });
      }

      const wantRender =
        req.query.render === "1" ||
        Boolean((req.body as { render?: boolean } | undefined)?.render);
      let renderResult: unknown = null;
      if (wantRender && missing === 0) {
        renderResult = await renderJob(job.jobId, { force: true });
      }

      res.json({
        ok: true,
        scenes: scenesWithEffects.length,
        missing,
        library: library.length,
        canRender: missing === 0,
        render: renderResult,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Internal tool: realism prompt + optional GPT Image 2 still.
   * ContactBox reasons the prompt; OpenAI Image key generates.
   * Optional source=pexels searches free stock instead of generating.
   */
  app.post("/api/mystery-v2/realism/generate", async (req, res) => {
    try {
      const body = req.body || {};
      const visualIdea = String(body.visualIdea || body.idea || "").trim();
      if (!visualIdea) {
        return res.status(400).json({ error: "visualIdea is required" });
      }

      const source = String(body.source || body.option || "realism").trim().toLowerCase();

      if (source === "pexels" || source === "stock") {
        if (!getPexelsKey()) {
          return res.status(400).json({
            error: "PEXELS_API_KEY is not configured",
            hint: "Add PEXELS_API_KEY to .env for Mystery v2 stock search",
          });
        }
        const hits = await searchPexelsImages(visualIdea, Number(body.count) || 8);
        return res.json({
          ok: true,
          option: "mystery-v2",
          source: "pexels",
          query: visualIdea,
          hits,
          pexelsConfigured: true,
        });
      }

      if (source === "free_stock") {
        const [pexels, pixabay] = await Promise.all([
          searchPexelsImages(visualIdea, Number(body.count) || 8),
          searchPixabayImages(visualIdea, Number(body.count) || 8),
        ]);
        const hits = [...pexels, ...pixabay].slice(0, Number(body.count) || 8);
        return res.json({
          ok: true,
          option: "mystery-v2",
          source: "free_stock",
          query: visualIdea,
          hits,
          pexelsConfigured: Boolean(getPexelsKey()),
        });
      }

      const result = await generateMysteryRealismStill({
        title: body.title ? String(body.title) : undefined,
        visualIdea,
        intendedUse: body.intendedUse ? String(body.intendedUse) : undefined,
        preferredStyle: body.preferredStyle ? String(body.preferredStyle) : undefined,
        aspectRatio: body.aspectRatio === "4:3" ? "4:3" : "16:9",
        realismLevel: body.realismLevel ? String(body.realismLevel) : undefined,
        generateImage: body.generateImage !== false,
        filename: body.filename ? String(body.filename) : undefined,
        jobId: body.jobId ? String(body.jobId) : undefined,
      });

      const reportPath = path.join(
        config.storagePath,
        "generated-images",
        `mystery-v2-realism-report-${Date.now()}.json`
      );
      await writeJson(reportPath, {
        option: "mystery-v2",
        source: "realism",
        ...result,
        savedAt: new Date().toISOString(),
      });

      res.json({
        ok: true,
        option: "mystery-v2",
        source: "realism",
        pack: result.pack,
        imagePrompt: result.imagePrompt,
        image: result.image,
        reportPath,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/mystery-v2/realism/recipe", (_req, res) => {
    res.json({
      option: "mystery-v2",
      model: "gpt-image-2",
      size: "1536x1024",
      quality: "low",
      aspectRatio: "16:9",
      reasoning: "ContactBox OPENAI_API_KEY / OPENAI_BASE_URL",
      images: "OPENAI_IMAGE_API_KEY → api.openai.com",
      stock: "PEXELS_API_KEY (source=pexels) + PIXABAY_API_KEY (source=free_stock)",
      note: "Internal realism / stock tool — does not choose timeline visuals alone.",
      references: "remotion/public/reference/mystery-realism/",
      sources: ["realism", "pexels", "free_stock"],
    });
  });

  app.get("/api/mystery-v2/pack", (_req, res) => {
    const templates = listMysteryPackTemplateFiles();
    res.json({
      name: "Mystery Documentary Pack v2 (Remotion / RunPod)",
      renderer: "runpod",
      stage: false,
      primaryRenderer: "runpod",
      note: "Mystery v2 final renders use RunPod Remotion only. Shotstack pack preview render is disabled.",
      templates,
      presets: MYSTERY_PACK_PRESETS,
      fx: {
        effects: MYSTERY_V2_SHOTSTACK_EFFECTS,
        filters: MYSTERY_V2_SHOTSTACK_FILTERS,
        transitions: MYSTERY_V2_SHOTSTACK_TRANSITIONS,
        density: MYSTERY_V2_FX_DENSITY,
      },
      overlays: MYSTERY_V2_OVERLAYS.map((o) => ({
        ...o,
        url: mysteryOverlayUrl(o),
      })),
    });
  });

  app.get("/api/mystery-v2/pack/templates", (_req, res) => {
    try {
      const loaded = loadAllMysteryPackTemplates().map(({ meta, template }) => ({
        ...meta,
        merge: template.merge,
        trackCount: template.timeline.tracks.length,
      }));
      res.json({ ok: true, presets: loaded });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/mystery-v2/pack/render", async (_req, res) => {
    res.status(410).json({
      ok: false,
      error:
        "Mystery v2 Shotstack pack render is disabled. Final Mystery v2 jobs render on RunPod (Remotion) via POST /api/jobs/:jobId/render.",
      renderer: "runpod",
    });
  });

  app.get("/api/mystery-v2/fx", (_req, res) => {
    res.json({
      option: "mystery-v2",
      effects: MYSTERY_V2_SHOTSTACK_EFFECTS,
      filters: MYSTERY_V2_SHOTSTACK_FILTERS,
      transitions: MYSTERY_V2_SHOTSTACK_TRANSITIONS,
      density: MYSTERY_V2_FX_DENSITY,
      overlays: MYSTERY_V2_OVERLAYS.map((o) => ({ ...o, url: mysteryOverlayUrl(o) })),
      note: "Catalog reference only. Mystery v2 finals render on RunPod Remotion (images-only). Hard cut is the default between clips.",
    });
  });
}
