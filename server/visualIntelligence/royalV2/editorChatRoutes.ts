import type { Express, Response } from "express";
import { loadJob } from "../../storage.js";
import {
  clearEditorChatHistory,
  getEditorChatHistory,
  handleEditorChat,
} from "./editorChat.js";

/**
 * Knowledge Editor chat routes (auth via app-level requireAuth).
 * Primary: /api/jobs/:jobId/editor-chat
 * Aliases: /api/royal-v2/jobs/:jobId/editor-chat, /api/jobs/:jobId/knowledge-editor/chat
 */
export function registerEditorChatRoutes(app: Express): void {
  const getHandler = async (jobId: string, res: Response) => {
    const job = await loadJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const history = await getEditorChatHistory(jobId);
    res.json({ history });
  };

  const deleteHandler = async (jobId: string, res: Response) => {
    const job = await loadJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    await clearEditorChatHistory(jobId);
    res.json({ ok: true });
  };

  const postHandler = async (
    jobId: string,
    body: { message?: string; sceneId?: string },
    res: Response
  ) => {
    const job = await loadJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const message = String(body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message required" });
    const sceneId = body?.sceneId ? String(body.sceneId) : undefined;
    const result = await handleEditorChat(jobId, message, { sceneId });
    res.json(result);
  };

  for (const base of [
    "/api/jobs/:jobId/editor-chat",
    "/api/royal-v2/jobs/:jobId/editor-chat",
    "/api/jobs/:jobId/knowledge-editor/chat",
  ]) {
    app.get(base, async (req, res) => {
      try {
        await getHandler(req.params.jobId, res);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
    app.delete(base, async (req, res) => {
      try {
        await deleteHandler(req.params.jobId, res);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
    app.post(base, async (req, res) => {
      try {
        await postHandler(req.params.jobId, req.body || {}, res);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }
}
