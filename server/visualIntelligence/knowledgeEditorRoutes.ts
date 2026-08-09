import type { Express } from "express";
import {
  EFFECT_PRESET_OPTIONS,
  loadTimelineForEditor,
  patchTimelineScenes,
  searchLibraryForEditor,
  swapSceneVisual,
} from "./timelineEditor.js";
import { royalAssetPreviewUrl } from "./royalV2/library.js";

/**
 * Timeline editor + legacy knowledge-editor library helpers.
 * Chat lives in registerEditorChatRoutes (editor-chat + knowledge-editor/chat aliases).
 */
export function registerKnowledgeEditorRoutes(app: Express): void {
  app.get("/api/jobs/:jobId/timeline", async (req, res) => {
    try {
      const payload = await loadTimelineForEditor(req.params.jobId);
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Job not found") return res.status(404).json({ error: message });
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/jobs/:jobId/timeline", async (req, res) => {
    try {
      const patches = Array.isArray(req.body?.patches) ? req.body.patches : [];
      if (!patches.length) return res.status(400).json({ error: "patches[] required" });
      const result = await patchTimelineScenes(req.params.jobId, patches);
      const payload = await loadTimelineForEditor(req.params.jobId);
      res.json({
        ok: true,
        updated: result.updated,
        job: payload.job,
        scenes: payload.scenes,
        effectPresets: payload.effectPresets,
        locked: payload.locked,
        musicEvents: payload.musicEvents,
        sfxEvents: payload.sfxEvents,
        effectEvents: payload.effectEvents,
        voiceoverUrl: payload.voiceoverUrl,
        durationSec: payload.durationSec,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/jobs/:jobId/timeline/swap-visual", async (req, res) => {
    try {
      const sceneId = String(req.body?.sceneId || "");
      const assetId = String(req.body?.assetId || "");
      if (!sceneId || !assetId) {
        return res.status(400).json({ error: "sceneId and assetId required" });
      }
      const result = await swapSceneVisual({
        jobId: req.params.jobId,
        sceneId,
        assetId,
      });
      const payload = await loadTimelineForEditor(req.params.jobId);
      const scene = payload.scenes.find((s) => s.sceneId === sceneId) || result.scene;
      res.json({ ok: true, scene, approved: result.approved, scenes: payload.scenes });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/knowledge-editor/library/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "q required" });
      const assets = await searchLibraryForEditor(q, Number(req.query.limit || 20));
      res.json({
        assets: assets.map((a) => ({
          assetId: a.assetId,
          person: a.person,
          mediaType: a.mediaType,
          category: a.category,
          description: a.description,
          previewUrl: royalAssetPreviewUrl(a),
        })),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/knowledge-editor/effect-presets", (_req, res) => {
    res.json({ presets: EFFECT_PRESET_OPTIONS });
  });
}
