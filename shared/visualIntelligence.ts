export type NicheStyle =
  | "Celebrity v1"
  | "Space v1"
  | "Mystery v1"
  | "Mystery v2"
  | "Royal v1"
  | "Royal v2"
  | "War v1";

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

export type VisualSource =
  | "raw_footage"
  | "user_youtube_raw"
  | "uploaded_asset"
  | "google_image"
  | "brave_image"
  | "pexels_clip"
  | "pexels_image"
  | "pixabay_clip"
  | "pixabay_image"
  | "fallback_card"
  | "cached_approved";

export type RawIngestStatus = "idle" | "queued" | "ingesting" | "ready" | "failed" | "skipped";

export interface UserYoutubeRawClip {
  clipId: string;
  sourceUrl: string;
  videoId: string;
  filePathOrUrl: string;
  thumbnail?: string;
  r2Key?: string;
  thumbKey?: string;
  startTime: number;
  endTime: number;
  duration: number;
  qualityScore: number;
  usableRaw: boolean;
  topics: string[];
  notes?: string;
}

export interface UserYoutubeRawIngestResult {
  clips: UserYoutubeRawClip[];
  analysisSummary: string;
  usableDurationSec: number;
  meanQuality: number;
  topicCoverage: number;
  usableScore: number;
  /** Base target before quality reduction (usually 20). */
  rawTargetPercent: number;
  /** Target after analysis — may be lower when usable yield is weak. */
  effectiveRawTargetPercent: number;
  rawReducedReason?: string;
  completedAt: string;
}

export interface JobRecord {
  jobId: string;
  title: string;
  niche: NicheStyle;
  script: string;
  /** Optional human/AI director notes applied during planning and editor chat */
  customEditInstructions?: string;
  voiceoverPath?: string;
  /** ffprobe duration of uploaded voiceover; master clock when set */
  voiceoverDurationSec?: number;
  /** How VO was obtained: uploaded file or ElevenLabs TTS */
  voiceoverSource?: "upload" | "elevenlabs";
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  /** Script↔VO word alignment (OpenAI Whisper); see job data voice-alignment.json */
  voiceAlignmentStatus?: "ready" | "failed" | "skipped";
  voiceAlignmentWordCount?: number;
  rawFootagePaths: string[];
  uploadedAssetPaths: string[];
  /** Optional 1–3 YouTube URLs from our channel (Celebrity / Mystery / Space). */
  userYoutubeRawUrls?: string[];
  rawIngestStatus?: RawIngestStatus;
  rawIngestError?: string;
  userYoutubeRawIngest?: UserYoutubeRawIngestResult;
  status: JobStatus;
  lastSuccessfulStatus?: JobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  batchId?: string;
  progressPercent?: number;
  stageStartedAt?: string;
  stageTimings?: Partial<Record<JobStatus, number>>;
  gptCallsUsed?: number;
  estimatedCostUsd?: number;
  stats?: PipelineStats;
  sceneApprovals?: Record<string, "approved" | "rejected" | "pending">;
  render?: {
    status: "idle" | "queued" | "rendering" | "completed" | "failed";
    outputKey?: string;
    outputPath?: string;
    /** Public or app-relative playable URL (prefer R2 when configured) */
    outputUrl?: string;
    /** R2 object key when final MP4 was uploaded to R2 */
    r2Key?: string;
    error?: string;
    shotstackId?: string;
    shotstackUrl?: string;
    renderer?: string;
    runpodPodId?: string;
    /** RunPod Serverless /run job id when using serverless path */
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

export interface PipelineStats {
  visualBeats: number;
  queryPacks: number;
  braveQueriesUsed: number;
  imageQueriesUsed?: number;
  candidatesCollected: number;
  candidatesFiltered: number;
  gptJudged: number;
  approvedLibrarySize: number;
  finalScenes: number;
  fallbackScenes: number;
  needsBetterVisualScenes?: number;
  wrongEntityWarnings: number;
  repeatedVisualWarnings: number;
  averageEditorScore?: number;
  exactMatchScenes?: number;
  strongMatchScenes?: number;
  goodContextScenes?: number;
  relatedContextScenes?: number;
  rawFootagePercent?: number;
  /** Configured raw mix target before quality reduction (e.g. 20). */
  rawTargetPercent?: number;
  /** Actual mix target used after ingest analysis. */
  effectiveRawTargetPercent?: number;
  rawReducedReason?: string;
  exactPersonMatches?: number;
  exactPlaceMatches?: number;
  weakScenes?: number;
  overusedVisuals?: number;
}

export interface TitleLock {
  jobId: string;
  title: string;
  mainSubject: string;
  centralObjectOrPlace: string;
  emotionalPromise: string;
  mysteryOrConflict: string;
  expectedVisuals: string[];
  forbiddenDrift: string[];
  createdAt: string;
}

export interface FullScriptVisualMap {
  jobId: string;
  mainVideoPromise: string;
  primaryVisualSubjects: string[];
  repeatedVisualSubjects: string[];
  exactPlaces: string[];
  exactObjects: string[];
  exactPeople: string[];
  exactCompanies: string[];
  exactDiscoveries: string[];
  exactDocuments: string[];
  technicalConcepts: string[];
  supportingContext: string[];
  mustNotShow: string[];
  titleSupportNotes: string;
  createdAt: string;
}

export interface GlobalContextReport {
  jobId: string;
  title: string;
  niche: NicheStyle;
  fullScript: string;
  sectionHeadings: string[];
  mainSubject: string;
  secondarySubjects: string[];
  people: string[];
  places: string[];
  companies: string[];
  events: string[];
  datesYears: string[];
  documents: string[];
  objectsProducts: string[];
  quotesStatements: string[];
  emotionalTone: string;
  timelineShifts: string[];
  confusingSimilarEntities: string[];
  forbiddenEntities: string[];
  shortNameExpansions: Record<string, string>;
  createdAt: string;
}

export interface VisualBeat {
  beatId: string;
  startTime: number;
  endTime: number;
  duration: number;
  narrationText: string;
  section: string;
  mentionedPeople: string[];
  mentionedCompanies: string[];
  mentionedPlaces: string[];
  mentionedEvents: string[];
  mentionedDocuments: string[];
  mentionedObjects: string[];
  mentionedDates: string[];
  visualIntent: string;
  idealVisualType: string;
  fallbackVisualType: string;
  importanceScore: number;
  mustMatchEntity?: string;
  forbiddenVisuals: string[];
  /** Editor brain fields */
  viewerShouldSee?: string;
  exactSubject?: string;
  visualRole?:
    | "main_subject"
    | "supporting_context"
    | "evidence"
    | "map"
    | "document"
    | "atmosphere"
    | "transition";
  mustShow?: string[];
  shouldAvoid?: string[];
  idealVisual?: string;
  fallbackVisual?: string;
  searchPriority?: number;
  beatType?: RoyalBeatType;
  mainPerson?: string;
  secondaryPeople?: string[];
  pairOrGroup?: string[];
  specificPlace?: string;
  contextType?: RoyalContextType | string;
  emotionalTone?: string;
  visualNeed?: string;
}

export interface QueryPack {
  queryPackId: string;
  relatedBeatIds: string[];
  entityContext: string;
  query: string;
  sourceType: "google" | "brave" | "pexels" | "pixabay" | "raw" | "upload" | "cache";
  expectedVisualType: string;
  priority: number;
  maxCandidates: number;
  whyNeeded?: string;
  idealResultType?: string;
  forbiddenResultType?: string;
}

export interface VisualCandidate {
  candidateId: string;
  source: VisualSource;
  urlOrPath: string;
  sourcePageUrl?: string;
  queryPackId?: string;
  queryUsed?: string;
  title?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
  dimensions?: { width: number; height: number };
  duration?: number;
  thumbnail?: string;
  detectedVisualType?: string;
  relatedEntities: string[];
  relatedBeatIds: string[];
  rejected?: boolean;
  rejectReason?: string;
  isTextHeavy?: boolean;
}

export interface JudgmentScores {
  entityMatch: number;
  sceneMatch: number;
  topicRelevance: number;
  eventPlaceYearRelevance: number;
  visualQuality: number;
  cropSafety16x9: number;
  sourceReliability: number;
  wrongEntityRisk: number;
  watermarkTextRisk: number;
  reusePotential: number;
  /** Editor brain scores (0–100, clamped) */
  visualEditorScore?: number;
  titleSupportScore?: number;
  narrationMatchScore?: number;
  instantClarityScore?: number;
  exactSubjectMatch?: number;
  horizontalUsability?: number;
  documentaryUsefulness?: number;
  textHeavyPenalty?: number;
  watermarkRisk?: number;
  alteredTextRisk?: number;
  wrongContextRisk?: number;
}

export interface CandidateJudgment {
  candidateId: string;
  approved: boolean;
  scores: JudgmentScores;
  reason: string;
  matchedEntities: string[];
  warnings: string[];
  editorDecision?: "approve" | "reject" | "reserve" | "fallback_only";
  editorReason?: string;
  isTextHeavy?: boolean;
  readableArea?: string;
  cropInstruction?: string;
}

export interface ApprovedVisual {
  approvedVisualId: string;
  source: VisualSource;
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
  confidenceScores: JudgmentScores;
  reuseLimit: number;
  cropInstructions?: string;
  durationRecommendation?: number;
  warnings: string[];
  candidateId: string;
  queryPackId?: string;
  supportsTitle?: boolean;
  matchedScriptSubjects?: string[];
  visualEditorScore?: number;
  titleSupportScore?: number;
  narrationMatchScore?: number;
  instantClarityScore?: number;
  horizontalUsability?: number;
  isTextHeavy?: boolean;
  libraryAssetId?: string;
  libraryGroup?: string;
  libraryCategory?: string;
  mediaType?: "image" | "raw_footage";
  royalScores?: RoyalCandidateScores;
}

export type MatchType =
  | "exact_match"
  | "strong_match"
  | "good_context"
  | "related_context"
  | "needs_better_visual";

export type SoftApprovalStatus = "pass" | "fail" | "unsure";

export interface SoftSceneApproval {
  softApproval: SoftApprovalStatus;
  reason: string;
  intendedPerson: string;
  detectedHint: string;
  mode?: "vision" | "text" | "skipped";
}

export interface SoftApprovalReport {
  jobId: string;
  createdAt: string;
  enabled: boolean;
  mode: "full" | "efficient" | "cheap_skip" | "disabled";
  checkedCount: number;
  skippedCount: number;
  passCount: number;
  failCount: number;
  unsureCount: number;
  failRate: number;
  blockedAutoApprove: boolean;
  blockThreshold: number;
  visionUsed: number;
  textOnlyUsed: number;
  scenes: Array<
    SoftSceneApproval & {
      sceneId: string;
      beatId: string;
      beatType?: string;
      confidence: number;
      mediaUrl?: string;
    }
  >;
}

export interface TimelineScene {
  sceneId: string;
  beatId: string;
  startTime: number;
  endTime: number;
  duration: number;
  narrationText: string;
  selectedVisualId: string;
  source: VisualSource;
  reasonSelected: string;
  confidence: number;
  /** @deprecated cards disabled — kept for compatibility; always false */
  fallbackUsed: boolean;
  needsBetterVisual?: boolean;
  matchType?: MatchType;
  viewerShouldSee?: string;
  whyThisMatchesTitle?: string;
  whyThisMatchesNarration?: string;
  whyThisIsAppropriate?: string;
  whatIsMissing?: string;
  repeatDistanceWarning?: boolean;
  cropFraming?: string;
  transition?: string;
  warnings: string[];
  approvedVisualId?: string;
  queryPackId?: string;
  confidenceScores?: JudgmentScores;
  isTextHeavy?: boolean;
  rawFootageUsed?: boolean;
  effects?: Array<Record<string, unknown>>;
  beatType?: RoyalBeatType;
  mainPerson?: string;
  secondaryPeople?: string[];
  pairOrGroup?: string[];
  specificPlace?: string;
  contextType?: RoyalContextType | string;
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
  /** AI soft check: correct person shown vs beat/narration intent */
  softApproval?: SoftApprovalStatus;
  softApprovalReason?: string;
  softApprovalIntendedPerson?: string;
  softApprovalDetectedHint?: string;
  softApprovalMode?: "vision" | "text" | "skipped";
  /** Planner intent summary (beatType + person/place/context). */
  selectionIntent?: string;
  /** Why this library asset was picked. */
  pickReason?: string;
  /** Timeline editor: mark scene for AI revision pass */
  markForAiRevise?: boolean;
  /** Free-form editor notes (effects / SFX / revision hints) */
  editorNotes?: string;
}

export interface ImportantEntityDetection {
  jobId: string;
  beats: Array<{
    beatId: string;
    entities: Array<{
      type: string;
      value: string;
      importance: number;
    }>;
  }>;
}

export interface FinalQAReport {
  jobId: string;
  criticalIssues: string[];
  warnings: string[];
  canRender: boolean;
  checkedAt: string;
  acceptance?: Record<string, number | string | boolean>;
}

export type RoyalBeatType =
  | "exact_person"
  | "exact_pair_or_group"
  | "exact_place"
  | "document_or_legal"
  | "media_or_palace_context"
  | "emotional_context"
  | "formal_or_court_context"
  | "generic_transition";

export type RoyalContextType =
  | "media_reaction"
  | "palace_pressure"
  | "public_attention"
  | "court_legal"
  | "family_crisis"
  | "private_meeting"
  | "crowds"
  | "arrivals"
  | "security"
  | "documents"
  | "church"
  | "mourning"
  | "formal"
  | "transition";

export interface RoyalCandidateScores {
  entityMatch: number;
  pairMatch: number;
  placeMatch: number;
  contextMatch: number;
  toneMatch: number;
  qualityScore: number;
  identityConfidence: number;
  cropSafety: number;
  rawFootageSuitability: number;
  repetitionRisk: number;
  freshnessScore: number;
  finalMatchScore: number;
}

export interface RoyalRepetitionViolation {
  sceneId: string;
  assetId: string;
  kind: "repeated_too_soon" | "overused_in_video" | "near_duplicate";
  severity: "warning" | "blocked";
  previousSceneId?: string;
  message: string;
}

export interface RoyalManagerSummary {
  jobId: string;
  totalScenes: number;
  averageSceneDuration: number;
  exactPersonScenes: number;
  exactPlaceScenes: number;
  contextScenes: number;
  rawFootageScenes: number;
  rawFootagePercent: number;
  /** Distinct raw asset IDs used (reuse only after unique pool is exhausted). */
  uniqueRawUsed?: number;
  rawScenesByMinute?: Record<string, number>;
  rawCadenceMet?: boolean;
  lowConfidenceScenes: number;
  repeatedVisualWarnings: number;
  genericContextForExactScene: number;
  softApprovalFails?: number;
  softApprovalUnsure?: number;
  softApprovalChecked?: number;
  topScenesNeedingReview: Array<{
    sceneId: string;
    startTime: number;
    reason: string;
    confidence: number;
  }>;
  recommendedFixes: string[];
  renderReady: boolean;
  createdAt: string;
}

export interface RoyalAssistantAction {
  action: string;
  target: string;
  reason: string;
  before: unknown;
  after: unknown;
  requiresConfirmation: boolean;
  applied?: boolean;
  createdAt?: string;
}

export interface RoyalBulkBatch {
  batchId: string;
  name: string;
  jobIds: string[];
  status: "queued" | "processing" | "review_ready" | "completed" | "partial_failure" | "failed";
  concurrency: number;
  jobSummaries?: Array<{
    jobId: string;
    title: string;
    stage: JobStatus;
    progressPercent: number;
    totalBeats: number;
    visualsAssigned: number;
    weakScenes: number;
    repeatedVisuals: number;
    rawFootagePercent: number;
    exactPersonMatches: number;
    exactPlaceMatches: number;
    gptCallsUsed: number;
    estimatedCostUsd: number;
    renderStatus: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export const COST_LIMITS_2MIN = {
  maxBraveQueries: 20,
  maxImageQueries: 22,
  maxQueryPacks: 15,
  maxCandidatesCollected: 160,
  maxCandidatesPerQuery: 10,
  /** Full pool judged in one holistic GPT editor pass (not tiny batches). */
  maxGptVisionJudgments: 160,
  maxRawFootageChunksDeeplyJudged: 60,
} as const;

export const COST_LIMITS_20MIN = {
  maxImageQueries: 160,
  maxQueryPacks: 120,
  maxCandidatesCollected: 800,
  maxCandidatesPerQuery: 10,
  maxGptVisionJudgments: 200,
  maxRawFootageChunksDeeplyJudged: 200,
} as const;

export type PipelineCostLimits = {
  maxBraveQueries: number;
  maxImageQueries: number;
  maxQueryPacks: number;
  maxCandidatesCollected: number;
  maxCandidatesPerQuery: number;
  maxGptVisionJudgments: number;
  maxRawFootageChunksDeeplyJudged: number;
};

/**
 * Scale pipeline budgets from VO/script duration.
 * Baseline = ~2 min (COST_LIMITS_2MIN). Soft ceilings keep API spend sane for long VO.
 */
export function costLimitsForDurationSec(durationSec: number): PipelineCostLimits {
  const d = Math.max(30, Number(durationSec) || 120);
  const scale = d / 120;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));
  return {
    maxBraveQueries: clamp(COST_LIMITS_2MIN.maxBraveQueries * scale, 20, 200),
    maxImageQueries: clamp(COST_LIMITS_2MIN.maxImageQueries * scale, 22, 300),
    maxQueryPacks: clamp(COST_LIMITS_2MIN.maxQueryPacks * scale, 15, 200),
    maxCandidatesCollected: clamp(COST_LIMITS_2MIN.maxCandidatesCollected * scale, 160, 1500),
    maxCandidatesPerQuery: COST_LIMITS_2MIN.maxCandidatesPerQuery,
    maxGptVisionJudgments: clamp(COST_LIMITS_2MIN.maxGptVisionJudgments * Math.min(scale, 4), 160, 600),
    maxRawFootageChunksDeeplyJudged: clamp(
      COST_LIMITS_2MIN.maxRawFootageChunksDeeplyJudged * scale,
      60,
      500
    ),
  };
}

export const WORDS_PER_MINUTE = 150;
export const WORDS_PER_SECOND = WORDS_PER_MINUTE / 60;

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  uploaded: "uploaded",
  raw_ingest_queued: "raw footage queued (cloud)",
  raw_ingesting: "ingesting YouTube raw (cloud)",
  raw_ready: "raw footage ready",
  raw_ingest_failed: "raw ingest failed — using images",
  analyzing_full_script: "analyzing full script",
  creating_visual_beats: "creating visual beats",
  creating_query_packs: "creating query packs",
  collecting_visual_candidates: "collecting visual candidates",
  judging_candidates: "judging candidates",
  building_approved_visual_library: "building approved visual library",
  assembling_timeline: "assembling timeline",
  queued: "queued",
  script_analysis: "script analysis",
  beat_breakdown: "beat breakdown",
  library_candidate_collection: "library candidate collection",
  visual_assignment: "visual assignment",
  repetition_audit: "repetition audit",
  weak_scene_repair: "weak scene repair",
  effect_planning: "effect planning",
  scene_review_ready: "scene review ready",
  approved: "approved",
  ready_for_scene_review: "ready for scene review",
  render_queued: "render queued (RunPod)",
  rendering: "rendering",
  completed: "completed",
  failed: "failed",
};

/** Niches that support optional pasted YouTube raw links (~20% mix). */
export const YOUTUBE_RAW_SUPPORTED_NICHES: NicheStyle[] = [
  "Celebrity v1",
  "Mystery v1",
  "Mystery v2",
  "Space v1",
  "War v1",
];

export const USER_YOUTUBE_RAW_BASE_TARGET = 0.2;
export const USER_YOUTUBE_RAW_MIN_BAND = 0.16;
export const USER_YOUTUBE_RAW_MAX_BAND = 0.24;
