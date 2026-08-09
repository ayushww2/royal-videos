/**
 * Job-scoped GPT-5.6 Knowledge Editor chatbot (ContactBox via OPENAI_BASE_URL).
 * Structured JSON tool loop — more reliable on OpenAI-compatible proxies than native tools.
 */
import { optionalEnv, checkRenderApis, getRenderer } from "../../config.js";
import { chatJson } from "../../openaiClient.js";
import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import { queueRunpodRender } from "../../render/runpodQueue.js";
import { loadRunpodState, getRunpodPod } from "../../render/runpodClient.js";
import type { JobRecord, RoyalManagerSummary, TimelineScene } from "../../../shared/visualIntelligence.js";
import {
  EFFECT_PRESET_OPTIONS,
  loadTimelineScenes,
  patchTimelineScenes,
  swapSceneVisual,
} from "../timelineEditor.js";
import {
  browseRoyalLibraryForEditor,
  searchRoyalLibraryForEditor,
  searchWebImagesForEditor,
} from "./editorSearch.js";
import { EDITOR_TOOL_SCHEMAS } from "./editorToolSchemas.js";
import { enqueueRoyalV2Job } from "./queue.js";

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type EditorChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  toolName?: string;
  toolResult?: unknown;
};

export type EditorChatHistory = {
  jobId: string;
  messages: EditorChatMessage[];
  updatedAt: string;
};

/** @deprecated alias — same shape as EditorChatHistory */
export type KnowledgeChatHistory = EditorChatHistory;
/** @deprecated alias */
export type KnowledgeChatMessage = EditorChatMessage;

type ToolName =
  | "get_job_status"
  | "get_timeline_summary"
  | "get_render_progress"
  | "list_scenes"
  | "search_library"
  | "search_royal_library"
  | "search_web_images"
  | "browse_royal_library"
  | "swap_scene_visual"
  | "enqueue_runpod_render"
  | "apply_revision_instructions"
  | "set_scene_notes"
  | "mark_scenes_for_revise"
  | "set_effect_preset";

type ModelTurn =
  | { type: "reply"; message: string }
  | { type: "tool"; tool: string; args?: Record<string, unknown>; thought?: string };

const TOOLS: ToolName[] = [
  "get_job_status",
  "get_timeline_summary",
  "get_render_progress",
  "list_scenes",
  "search_library",
  "search_royal_library",
  "search_web_images",
  "browse_royal_library",
  "swap_scene_visual",
  "enqueue_runpod_render",
  "apply_revision_instructions",
  "set_scene_notes",
  "mark_scenes_for_revise",
  "set_effect_preset",
];

/** Accept camelCase / schema aliases from the model. */
const TOOL_ALIASES: Record<string, ToolName> = {
  getJobStatus: "get_job_status",
  getTimelineSummary: "get_timeline_summary",
  getRenderProgress: "get_render_progress",
  listScenes: "list_scenes",
  searchLibrary: "search_library",
  searchRoyalLibrary: "search_royal_library",
  searchWebImages: "search_web_images",
  browseRoyalLibrary: "browse_royal_library",
  swapSceneVisual: "swap_scene_visual",
  swap_visual: "swap_scene_visual",
  enqueueRunPodRender: "enqueue_runpod_render",
  enqueue_runpod_render: "enqueue_runpod_render",
  applyRevisionInstructions: "apply_revision_instructions",
  set_custom_instructions: "apply_revision_instructions",
  setCustomInstructions: "apply_revision_instructions",
  setSceneNotes: "set_scene_notes",
  markScenesForRevise: "mark_scenes_for_revise",
  setEffectPreset: "set_effect_preset",
};

function editorModel(): string {
  return (
    optionalEnv("KNOWLEDGE_EDITOR_MODEL") ||
    optionalEnv("EDITOR_CHAT_MODEL") ||
    optionalEnv("OPENAI_MODEL") ||
    "gpt-5.6"
  );
}

function msgId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function historyFile(jobId: string): string {
  return jobDataFile("editor-chat", jobId);
}

async function loadHistory(jobId: string): Promise<EditorChatHistory> {
  const existing =
    (await readJson<EditorChatHistory>(historyFile(jobId))) ||
    (await readJson<EditorChatHistory>(jobDataFile("knowledge-editor-chat", jobId)));
  if (existing?.messages) return existing;
  return { jobId, messages: [], updatedAt: new Date().toISOString() };
}

async function saveHistory(history: EditorChatHistory): Promise<void> {
  history.updatedAt = new Date().toISOString();
  await writeJson(historyFile(history.jobId), history);
  // Mirror for any older clients still reading knowledge-editor-chat.
  await writeJson(jobDataFile("knowledge-editor-chat", history.jobId), history);
}

function resolveTool(name: string): ToolName | null {
  if (TOOLS.includes(name as ToolName)) return name as ToolName;
  return TOOL_ALIASES[name] || null;
}

function playableUrl(job: JobRecord): string | undefined {
  return (
    job.render?.outputUrl ||
    job.render?.shotstackUrl ||
    (job.render?.outputKey ? `/media/${job.render.outputKey}` : undefined)
  );
}

async function readRenderSidecars(jobId: string): Promise<Record<string, unknown>> {
  const [audit, propsMeta, qa] = await Promise.all([
    readJson<Record<string, unknown>>(jobDataFile("render-audit", jobId)),
    readJson<Record<string, unknown>>(jobDataFile("remotion-input-props", jobId)),
    readJson<Record<string, unknown>>(jobDataFile("visual-intelligence-final-qa", jobId)),
  ]);
  let runpodState: unknown = null;
  let podDesired: string | null = null;
  try {
    runpodState = await loadRunpodState();
    const podId =
      (runpodState as { podId?: string } | null)?.podId ||
      (await loadJob(jobId))?.render?.runpodPodId;
    if (podId) {
      const pod = await getRunpodPod(podId);
      podDesired = pod?.desiredStatus || null;
    }
  } catch {
    // Pod lookup is best-effort; status tools must still work offline.
  }
  return {
    renderAudit: audit
      ? {
          status: audit.status,
          renderer: audit.renderer,
          updatedAt: audit.updatedAt || audit.completedAt,
          error: audit.error,
        }
      : null,
    remotionPropsReady: Boolean(propsMeta),
    qa: qa
      ? {
          canRender: qa.canRender,
          criticalIssues: qa.criticalIssues,
          warnings: Array.isArray(qa.warnings) ? (qa.warnings as unknown[]).slice(0, 8) : [],
        }
      : null,
    runpodWorkerState: runpodState,
    podDesiredStatus: podDesired,
  };
}

async function executeTool(
  jobId: string,
  tool: ToolName,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");

  switch (tool) {
    case "get_job_status": {
      const renderApis = checkRenderApis();
      const sidecars = await readRenderSidecars(jobId);
      return {
        jobId: job.jobId,
        title: job.title,
        niche: job.niche,
        status: job.status,
        progressPercent: job.progressPercent ?? 0,
        customEditInstructions: job.customEditInstructions || "",
        timelineLocked: Boolean(job.timelineLock?.locked),
        render: job.render || { status: "idle" },
        playableUrl: playableUrl(job),
        stats: job.stats,
        renderer: getRenderer(),
        runpodReady: getRenderer() === "runpod" && renderApis.ok,
        setupError: renderApis.ok ? null : `Missing: ${renderApis.missing.join(", ")}`,
        ...sidecars,
      };
    }
    case "get_timeline_summary": {
      const scenes = await loadTimelineScenes(jobId);
      const summary = await readJson<RoyalManagerSummary>(
        jobDataFile("royal-v2-manager-summary", jobId)
      );
      const marked = scenes.filter((s) => s.markForAiRevise).length;
      const withEffects = scenes.filter((s) => (s.effects?.length || 0) > 0).length;
      return {
        sceneCount: scenes.length,
        markedForRevise: marked,
        withEffects,
        durationSec: scenes.reduce((n, s) => n + (s.duration || 0), 0),
        weakScenes: scenes.filter((s) => s.needsBetterVisual || s.confidence < 0.7).length,
        managerSummary: summary
          ? {
              lowConfidenceScenes: summary.lowConfidenceScenes,
              repeatedVisualWarnings: summary.repeatedVisualWarnings,
              rawFootagePercent: summary.rawFootagePercent,
              exactPersonScenes: summary.exactPersonScenes,
              exactPlaceScenes: summary.exactPlaceScenes,
            }
          : null,
        customEditInstructions: job.customEditInstructions || "",
      };
    }
    case "get_render_progress": {
      const fresh = await loadJob(jobId);
      if (!fresh) return { error: "Job not found" };
      const sidecars = await readRenderSidecars(jobId);
      return {
        status: fresh.status,
        renderStatus: fresh.render?.status || "idle",
        progressPercent: fresh.render?.progressPercent ?? fresh.progressPercent ?? 0,
        message: fresh.render?.message || fresh.error,
        podId: fresh.render?.runpodPodId,
        playableUrl: playableUrl(fresh),
        r2Key: fresh.render?.r2Key,
        error: fresh.render?.error || fresh.error,
        ...sidecars,
      };
    }
    case "list_scenes": {
      const scenes = await loadTimelineScenes(jobId);
      const offset = Math.max(0, Number(args.offset ?? args.from ?? 0));
      const limit = Math.min(40, Math.max(1, Number(args.limit || 12)));
      const slice = scenes.slice(offset, offset + limit);
      return {
        total: scenes.length,
        offset,
        limit,
        scenes: slice.map((s, i) => ({
          index: offset + i + 1,
          sceneId: s.sceneId,
          startTime: s.startTime,
          duration: s.duration,
          mainPerson: s.mainPerson,
          specificPlace: s.specificPlace,
          beatType: s.beatType,
          selectedVisualId: s.selectedVisualId,
          confidence: s.confidence,
          needsBetterVisual: s.needsBetterVisual,
          markForAiRevise: s.markForAiRevise,
          editorNotes: s.editorNotes,
          effectPresets: (s.effects || []).map((e) =>
            String((e as { presetId?: string }).presetId || "")
          ),
          narrationPreview: (s.narrationText || "").slice(0, 140),
        })),
      };
    }
    case "search_library":
    case "search_royal_library": {
      try {
        const mediaType =
          args.mediaType === "image" || args.mediaType === "raw_footage"
            ? args.mediaType
            : undefined;
        return await searchRoyalLibraryForEditor({
          q: String(args.query || args.q || "").trim() || undefined,
          person: String(args.person || "").trim() || undefined,
          mediaType,
          limit: Number(args.limit || 12),
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), assets: [] };
      }
    }
    case "search_web_images": {
      try {
        return await searchWebImagesForEditor(
          String(args.query || args.q || "").trim(),
          Number(args.limit || 8)
        );
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), hits: [] };
      }
    }
    case "browse_royal_library": {
      try {
        const mediaType =
          args.mediaType === "image" || args.mediaType === "raw_footage"
            ? args.mediaType
            : undefined;
        return await browseRoyalLibraryForEditor({
          person: String(args.person || "").trim() || undefined,
          mediaType,
          category: String(args.category || "").trim() || undefined,
          limit: Number(args.limit || 24),
          offset: Number(args.offset || 0),
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), assets: [] };
      }
    }
    case "swap_scene_visual": {
      const sceneId = String(args.sceneId || "");
      const assetId = String(args.assetId || args.libraryId || "");
      if (!sceneId || !assetId) return { error: "sceneId and assetId required" };
      const result = await swapSceneVisual({ jobId, sceneId, assetId });
      return {
        ok: true,
        sceneId: result.scene.sceneId,
        selectedVisualId: result.scene.selectedVisualId,
        reasonSelected: result.scene.reasonSelected,
      };
    }
    case "enqueue_runpod_render": {
      if (getRenderer() !== "runpod") {
        return {
          error: `Renderer is "${getRenderer()}". Set RENDERER=runpod or RUNPOD_RENDER=1 to enqueue RunPod.`,
        };
      }
      const renderApis = checkRenderApis();
      if (!renderApis.ok) {
        return { error: `RunPod not configured: ${renderApis.missing.join(", ")}` };
      }
      const force = Boolean(args.force);
      const queued = await queueRunpodRender(jobId, { force });
      return {
        ok: true,
        ...queued,
        message: `RunPod render queued (pod ${queued.podId}, action ${queued.action})`,
      };
    }
    case "apply_revision_instructions": {
      const text = String(
        args.instructions || args.notes || args.customEditInstructions || args.revision || ""
      ).trim();
      if (!text) return { error: "instructions required" };
      const append = Boolean(args.append);
      const next = append && job.customEditInstructions
        ? `${job.customEditInstructions.trim()}\n\n${text}`
        : text;
      job.customEditInstructions = next;
      job.updatedAt = new Date().toISOString();
      await saveJob(job);
      await writeJson(jobDataFile("custom-edit-instructions", jobId), {
        jobId,
        customEditInstructions: next,
        updatedAt: job.updatedAt,
        source: "editor_chat",
      });
      await writeJson(jobDataFile("revision-instructions", jobId), {
        jobId,
        instructions: next,
        updatedAt: job.updatedAt,
        source: "editor_chat",
        reprocess: Boolean(args.reprocess),
      });

      let reprocess: { queued: boolean; error?: string } | null = null;
      const wantReprocess =
        args.reprocess === undefined ? false : Boolean(args.reprocess);
      if (wantReprocess && job.niche === "Royal v2") {
        try {
          job.status = "queued";
          job.progressPercent = 0;
          job.updatedAt = new Date().toISOString();
          await saveJob(job);
          await enqueueRoyalV2Job(jobId);
          reprocess = { queued: true };
        } catch (err) {
          reprocess = {
            queued: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return {
        ok: true,
        customEditInstructions: next,
        reprocess,
        note: wantReprocess
          ? "Revision notes saved; Royal v2 pipeline re-enqueue attempted when reprocess=true."
          : "Revision notes saved. Pass reprocess=true to re-run the Royal v2 pipeline.",
      };
    }
    case "set_scene_notes": {
      const sceneId = String(args.sceneId || "");
      if (!sceneId) return { error: "sceneId required" };
      const result = await patchTimelineScenes(jobId, [
        {
          sceneId,
          editorNotes: String(args.notes || args.editorNotes || ""),
          markForAiRevise:
            args.markForAiRevise === undefined ? undefined : Boolean(args.markForAiRevise),
        },
      ]);
      return { ok: true, updated: result.updated };
    }
    case "mark_scenes_for_revise": {
      const sceneIds = Array.isArray(args.sceneIds)
        ? args.sceneIds.map(String)
        : args.sceneId
          ? [String(args.sceneId)]
          : [];
      if (!sceneIds.length) return { error: "sceneIds required" };
      const mark = args.mark === undefined ? true : Boolean(args.mark);
      const result = await patchTimelineScenes(
        jobId,
        sceneIds.map((sceneId) => ({ sceneId, markForAiRevise: mark }))
      );
      return { ok: true, marked: mark, updated: result.updated };
    }
    case "set_effect_preset": {
      const sceneId = String(args.sceneId || "");
      const presetId = String(args.presetId || args.effectPresetId || "");
      if (!sceneId) return { error: "sceneId required" };
      if (args.clear) {
        const result = await patchTimelineScenes(jobId, [{ sceneId, clearEffects: true }]);
        return { ok: true, cleared: true, updated: result.updated };
      }
      const allowed = EFFECT_PRESET_OPTIONS.some((p) => p.id === presetId);
      if (!allowed) {
        return {
          error: `Unknown preset. Allowed: ${EFFECT_PRESET_OPTIONS.map((p) => p.id).join(", ")}`,
        };
      }
      const result = await patchTimelineScenes(jobId, [
        { sceneId, effectPresetId: presetId as never },
      ]);
      return { ok: true, presetId, updated: result.updated };
    }
    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

function systemPrompt(job: JobRecord, scenes: TimelineScene[]): string {
  return `You are the AI Knowledge Editor — a senior documentary director + finishing editor for this factory job.
You revise visuals, effects intent, revision notes, and can enqueue RunPod renders. Think like a director: clarity of story, identity accuracy, pacing, and restraint.

Job niche: ${job.niche}
Title: ${job.title}
Status: ${job.status}
Custom edit instructions: ${job.customEditInstructions || "(none)"}
Scene count: ${scenes.length}
Timeline locked: ${Boolean(job.timelineLock?.locked)}

## Royal documentary editing rules
- Prefer exact person / place / pair matches from the Royal Media Library before any external search.
- Never invent asset IDs — call search_royal_library / search_library first, then swap_scene_visual with a real assetId.
- Prefer royal library over search_web_images; web search is fallback for stills only when the library is empty.
- Hard identity: do not put person B footage on a beat locked to person A.
- Respect timeline lock — mutating tools fail until the manager unlocks.
- Exact-person and exact-place beats beat generic palace/context B-roll.
- Prefer raw footage when the beat is motion/arrival/ceremony and a strong clip exists; still images for portraits/archive stillness.
- Avoid repeating the same asset within ~60s; call out overuse via timeline summary / weak scenes.

## Effects policy (visual overlays)
- Use production presets only (set_effect_preset). Per ~1 minute target cadence for Royal v2:
  ~2–3 lower thirds, ~2 split comparisons, ~2 glass/soft-glass/zoom presentations, ~1 red-grid archive beat, sparse quotes/reveal questions when narration supports them.
- On-screen copy is public-facing titles only — never dump backend instructions onto graphics.
- Do not stack heavy effects on every cut; keep editorial breathing room.

## SFX policy
- Soft whooshes on scene changes; accents (shutter/flash/film gate/hits) only on press, archive, or legal turns.
- Keep SFX under VO — note intent in editorNotes / revision instructions rather than inventing new audio files.

## Music policy
- Sparse documentary beds under VO; typically max ~3 tracks per full video.
- Beds stay quiet (~0.08–0.12). Note mood/placement intent in revision instructions; music planner runs in pipeline, not by inventing files here.

## Glitch policy
- Sparse ~0.75s screen-blend glitch overlays on rare chapter / crisis / reveal turns — about 1 per minute max, not every cut.
- Prefer subtler glitches; note intent rather than forcing overlays on calm portrait scenes.

## Director mindset
- Diagnose before mutating: get_job_status / get_timeline_summary / list_scenes.
- For "make it better" asks: identify weak/repeated/wrong-identity scenes, search library, swap, then summarize.
- For "ASAP render": check QA via get_render_progress, then enqueue_runpod_render (force only if user insists).
- apply_revision_instructions stores director notes; set reprocess=true only when the user wants the Royal v2 pipeline re-run.

Respond ONLY as JSON with one of:
{"type":"tool","tool":"<name>","args":{...},"thought":"..."}
{"type":"reply","message":"..."}

Allowed tools: ${TOOLS.join(", ")}
(Aliases accepted: getJobStatus, listScenes, swapSceneVisual, enqueueRunPodRender, applyRevisionInstructions, searchLibrary, searchRoyalLibrary, searchWebImages, browseRoyalLibrary.)
Search tool schemas (Phase D): ${EDITOR_TOOL_SCHEMAS.map((t) => t.function.name).join(", ")}.
Keep replies concise and actionable. Prefer tools for status, scenes, swaps, renders, and revisions.`;
}

export async function getEditorChatHistory(jobId: string): Promise<EditorChatHistory> {
  return loadHistory(jobId);
}

export async function clearEditorChatHistory(jobId: string): Promise<void> {
  await saveHistory({ jobId, messages: [], updatedAt: new Date().toISOString() });
}

/** @deprecated aliases for knowledge-editor routes */
export const getKnowledgeEditorHistory = getEditorChatHistory;
export const clearKnowledgeEditorHistory = clearEditorChatHistory;

export async function handleEditorChat(
  jobId: string,
  userMessage: string,
  opts?: { sceneId?: string }
): Promise<{
  reply: string;
  history: EditorChatHistory;
  toolTrace: Array<{ tool: string; result: unknown }>;
}> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const scenes = await loadTimelineScenes(jobId);
  const history = await loadHistory(jobId);

  const userMsg: EditorChatMessage = {
    id: msgId(),
    role: "user",
    content: opts?.sceneId
      ? `[Focused scene: ${opts.sceneId}] ${userMessage}`
      : userMessage,
    createdAt: new Date().toISOString(),
  };
  history.messages.push(userMsg);

  const recent = history.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const toolTrace: Array<{ tool: string; result: unknown }> = [];
  let finalReply = "";
  let toolContext = "";

  for (let step = 0; step < 6; step++) {
    const turn = await chatJson<ModelTurn>({
      model: editorModel(),
      temperature: 0.2,
      system: systemPrompt(job, scenes),
      user: JSON.stringify({
        userMessage: userMsg.content,
        recentChat: recent,
        focusedSceneId: opts?.sceneId || null,
        previousToolResults: toolContext || null,
        effectPresets: EFFECT_PRESET_OPTIONS.map((p) => p.id),
        searchToolSchemas: EDITOR_TOOL_SCHEMAS,
      }),
    });

    job.gptCallsUsed = (job.gptCallsUsed || 0) + 1;
    job.estimatedCostUsd = Number(((job.gptCallsUsed || 0) * 0.02).toFixed(2));

    if (turn.type === "reply" || !turn.type) {
      finalReply = (turn as { message?: string }).message || "Done.";
      break;
    }

    if (turn.type === "tool") {
      const tool = resolveTool(String(turn.tool || ""));
      if (!tool) {
        finalReply = `Unsupported tool requested: ${String(turn.tool)}`;
        break;
      }
      let result: unknown;
      try {
        result = await executeTool(jobId, tool, turn.args || {});
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      toolTrace.push({ tool, result });
      toolContext += `\nTOOL ${tool} => ${JSON.stringify(result).slice(0, 4000)}`;
      history.messages.push({
        id: msgId(),
        role: "tool",
        content: `${tool}: ${JSON.stringify(result).slice(0, 1500)}`,
        createdAt: new Date().toISOString(),
        toolName: tool,
        toolResult: result,
      });
      continue;
    }

    finalReply = "I could not parse a valid editor response.";
    break;
  }

  if (!finalReply) {
    const last = toolTrace[toolTrace.length - 1];
    finalReply = last
      ? `Finished ${last.tool}. ${JSON.stringify(last.result).slice(0, 600)}`
      : "No response generated.";
  }

  history.messages.push({
    id: msgId(),
    role: "assistant",
    content: finalReply,
    createdAt: new Date().toISOString(),
  });
  await saveHistory(history);
  await saveJob(job);

  return { reply: finalReply, history, toolTrace };
}

/** @deprecated alias */
export const handleKnowledgeEditorChat = handleEditorChat;
