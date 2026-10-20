/**
 * Royal v3: the Anne job path.
 * Whisper times one script line as one scene, then the context pass picks the library visual.
 */
import { loadJob, saveJob } from "../../storage.js";
import { ensureVoiceAlignment } from "../voiceAlignment.js";
import { publishWhisperLineScenes } from "../whisperLineScenes.js";
import { assignContextVisuals } from "../royalV2/contextVisualAssign.js";
import type { JobRecord } from "../../../shared/visualIntelligence.js";

export async function runRoyalV3Pipeline(jobId: string): Promise<JobRecord> {
  const job = await loadJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.niche !== "Royal v3") throw new Error("Royal v3 pipeline requires a Royal v3 job");
  if (!job.voiceoverPath) throw new Error("Royal v3 needs the voiceover file");

  job.status = "script_analysis";
  job.progressPercent = 8;
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  const alignment = await ensureVoiceAlignment(job);
  if (alignment.status !== "ready" || !alignment.words.length) {
    throw new Error(alignment.error || "Whisper did not return word timings");
  }
  job.voiceAlignmentStatus = "ready";
  job.voiceAlignmentWordCount = alignment.words.length;
  job.progressPercent = 28;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  await publishWhisperLineScenes(job);

  const timed = await loadJob(jobId);
  if (!timed) throw new Error(`Job not found: ${jobId}`);
  timed.status = "visual_assignment";
  timed.progressPercent = 40;
  timed.updatedAt = new Date().toISOString();
  await saveJob(timed);

  await assignContextVisuals(jobId);
  return (await loadJob(jobId)) || timed;
}
