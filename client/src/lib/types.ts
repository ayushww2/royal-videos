export type JobStatus =
  | "uploaded"
  | "raw_ingest_queued"
  | "raw_ingesting"
  | "raw_ready"
  | "raw_ingest_failed"
  | "analyzing_full_script"
  | "creating_visual_beats"
  | "creating_query_packs"
  | "collecting_visual_candidates"
  | "judging_candidates"
  | "building_approved_visual_library"
  | "assembling_timeline"
  | "queued"
  | "script_analysis"
  | "beat_breakdown"
  | "library_candidate_collection"
  | "visual_assignment"
  | "repetition_audit"
  | "weak_scene_repair"
  | "effect_planning"
  | "scene_review_ready"
  | "approved"
  | "ready_for_scene_review"
  | "render_queued"
  | "rendering"
  | "completed"
  | "failed";

export interface JobRecord {
  jobId: string;
  title: string;
  niche: string;
  script: string;
  customEditInstructions?: string;
  voiceoverDurationSec?: number;
  voiceoverSource?: "upload" | "elevenlabs";
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  userYoutubeRawUrls?: string[];
  rawIngestStatus?: "idle" | "queued" | "ingesting" | "ready" | "failed" | "skipped";
  rawIngestError?: string;
  voiceAlignmentStatus?: "ready" | "failed" | "skipped";
  voiceAlignmentWordCount?: number;
  status: JobStatus;
  lastSuccessfulStatus?: JobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  batchId?: string;
  progressPercent?: number;
  gptCallsUsed?: number;
  estimatedCostUsd?: number;
  stats?: {
    visualBeats: number;
    queryPacks: number;
    finalScenes: number;
    fallbackScenes: number;
    approvedLibrarySize: number;
    wrongEntityWarnings: number;
    repeatedVisualWarnings: number;
    rawFootagePercent?: number;
    rawTargetPercent?: number;
    effectiveRawTargetPercent?: number;
    rawReducedReason?: string;
    exactPersonMatches?: number;
    exactPlaceMatches?: number;
    weakScenes?: number;
    overusedVisuals?: number;
  };
  sceneApprovals?: Record<string, "approved" | "rejected" | "pending">;
  render?: {
    status: "idle" | "queued" | "rendering" | "completed" | "failed";
    outputKey?: string;
    outputPath?: string;
    outputUrl?: string;
    r2Key?: string;
    error?: string;
    shotstackId?: string;
    shotstackUrl?: string;
    renderer?: string;
    runpodPodId?: string;
    runpodRunId?: string;
    progressPercent?: number;
    message?: string;
  };
  timelineLock?: {
    locked: boolean;
    hash: string;
    lockedAt: string;
    lockedBy: string;
    sceneCount: number;
  };
}

export interface Scene {
  sceneId: string;
  beatId: string;
  startTime: number;
  endTime: number;
  duration: number;
  narrationText: string;
  source: string;
  reasonSelected: string;
  confidence: number;
  warnings: string[];
  approvedVisualId?: string;
  queryPackId?: string;
  fallbackUsed?: boolean;
  needsBetterVisual?: boolean;
  matchType?: "exact_match" | "strong_match" | "good_context" | "related_context" | "needs_better_visual";
  viewerShouldSee?: string;
  whyThisMatchesTitle?: string;
  whyThisMatchesNarration?: string;
  whyThisIsAppropriate?: string;
  whatIsMissing?: string;
  selectedVisualId: string;
  confidenceScores?: Record<string, number>;
  previewUrl?: string;
  fromApprovedLibrary?: boolean;
  repeatDistanceWarning?: boolean;
  rawFootageUsed?: boolean;
  isTextHeavy?: boolean;
  effects?: Array<{
    id: string;
    presetId: string;
    reason?: string;
    durationFrames: number;
    startFrame: number;
    props: Record<string, unknown>;
    blocksSubtitles?: boolean;
    tags?: string[];
    renderProvider?: string;
    renderable?: boolean;
    simplified?: boolean;
    renderReason?: string;
    renderWarning?: string;
  }>;
  beatType?: string;
  mainPerson?: string;
  secondaryPeople?: string[];
  pairOrGroup?: string[];
  specificPlace?: string;
  contextType?: string;
  assetUsageCountVideo?: number;
  assetUsageCountCurrentMinute?: number;
  entityUsageCount?: number;
  nearDuplicateRisk?: number;
  lastUsedTimestamp?: number;
  identityConfidence?: number;
  placeConfidence?: number;
  alternativeAssetIds?: string[];
  rawFootageAvailable?: boolean;
  assistantSuggestionAvailable?: boolean;
  softApproval?: "pass" | "fail" | "unsure";
  softApprovalReason?: string;
  softApprovalIntendedPerson?: string;
  softApprovalDetectedHint?: string;
  softApprovalMode?: "vision" | "text" | "skipped";
  markForAiRevise?: boolean;
  editorNotes?: string;
  selectionIntent?: string;
  pickReason?: string;
  sfx?: Array<{
    id: string;
    sfxId: string;
    reason?: string;
    startTime?: number;
  }>;
}

export interface ApprovedVisual {
  approvedVisualId: string;
  source: string;
  filePathOrUrl: string;
  thumbnail?: string;
  matchedPeople: string[];
  matchedCompanies: string[];
  matchedPlaces: string[];
  matchedEvents: string[];
  matchedDocuments: string[];
  matchedObjects: string[];
  allowedBeatIds: string[];
  bestUseCase: string;
  confidenceScores: Record<string, number>;
  warnings: string[];
  queryPackId?: string;
  previewUrl?: string;
  usedByScenes?: string[];
  reuseCount?: number;
}

export const PIPELINE_STEPS: Array<{ key: JobStatus; label: string }> = [
  { key: "uploaded", label: "Uploaded" },
  { key: "raw_ingest_queued", label: "Raw footage queued (cloud)" },
  { key: "raw_ingesting", label: "Ingesting YouTube raw (cloud)" },
  { key: "raw_ready", label: "Raw footage ready" },
  { key: "raw_ingest_failed", label: "Raw ingest failed — images" },
  { key: "analyzing_full_script", label: "Analyzing full script" },
  { key: "creating_visual_beats", label: "Creating visual beats" },
  { key: "creating_query_packs", label: "Creating query packs" },
  { key: "collecting_visual_candidates", label: "Collecting visual candidates" },
  { key: "judging_candidates", label: "Judging candidates" },
  { key: "building_approved_visual_library", label: "Building approved visual library" },
  { key: "assembling_timeline", label: "Assembling timeline" },
  { key: "queued", label: "Queued" },
  { key: "script_analysis", label: "Script analysis" },
  { key: "beat_breakdown", label: "Beat breakdown" },
  { key: "library_candidate_collection", label: "Library candidate collection" },
  { key: "visual_assignment", label: "Visual assignment" },
  { key: "repetition_audit", label: "Repetition audit" },
  { key: "weak_scene_repair", label: "Weak scene repair" },
  { key: "effect_planning", label: "Effect planning" },
  { key: "scene_review_ready", label: "Scene review ready" },
  { key: "approved", label: "Approved & locked" },
  { key: "ready_for_scene_review", label: "Ready for scene review" },
  { key: "render_queued", label: "Render queued" },
  { key: "rendering", label: "Rendering" },
  { key: "completed", label: "Completed" },
];

export function statusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" | "violet" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "ready_for_scene_review" || status === "scene_review_ready" || status === "approved") return "violet";
  if (status === "rendering" || status === "render_queued" || status === "raw_ingest_failed") return "warning";
  if (
    status.includes("analyz") ||
    status.includes("creat") ||
    status.includes("collect") ||
    status.includes("judg") ||
    status.includes("build") ||
    status.includes("assembl") ||
    status.includes("raw_ingest") ||
    status === "raw_ready" ||
    status === "uploaded"
  ) {
    return "info";
  }
  return "neutral";
}

export function friendlyStatus(status: string): string {
  const map: Record<string, string> = {
    uploaded: "Draft",
    raw_ingest_queued: "Raw Queued (Cloud)",
    raw_ingesting: "Ingesting YouTube Raw",
    raw_ready: "Raw Ready",
    raw_ingest_failed: "Raw Failed — Images",
    analyzing_full_script: "Processing",
    creating_visual_beats: "Processing",
    creating_query_packs: "Processing",
    collecting_visual_candidates: "Processing",
    judging_candidates: "Processing",
    building_approved_visual_library: "Processing",
    assembling_timeline: "Processing",
    queued: "Queued",
    script_analysis: "Script Analysis",
    beat_breakdown: "Beat Breakdown",
    library_candidate_collection: "Library Collection",
    visual_assignment: "Visual Assignment",
    repetition_audit: "Repetition Audit",
    weak_scene_repair: "Weak Scene Repair",
    effect_planning: "Effect Planning",
    scene_review_ready: "Ready for Review",
    approved: "Approved & Locked",
    ready_for_scene_review: "Ready for Review",
    render_queued: "Render queued (RunPod)",
    rendering: "Rendering",
    completed: "Completed",
    failed: "Failed",
  };
  return map[status] || status.replaceAll("_", " ");
}
