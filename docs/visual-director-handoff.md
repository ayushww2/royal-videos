# Visual director handoff

This is the continuity note for the Royal documentary picture pass and the voice retiming that sits on top of it. A fresh chat should treat the editorial rules below as the bar the editor set, and the code sections as what the product actually does. Those two are not the same yet.

Live site: https://royal-videos-production.up.railway.app

Repo: `ayushww2/royal-videos`

Production commit as of 8 Oct 2026: `33b5a42` on branch `cursor/retime-voice-140-wpm-017b`, deployed with `serviceInstanceDeploy`. Health check `/api/health` returned 200 after that deploy.

Related pulls:

- Sentence scenes: https://github.com/ayushww2/royal-videos/pull/27 (`cursor/camilla-sentence-scenes-017b`, commits `5aa8504`, `01f7e91`)
- Voice retiming: https://github.com/ayushww2/royal-videos/pull/28 (`cursor/retime-voice-140-wpm-017b`, commit `33b5a42`)

Do not print API keys, session cookies, or the Railway token. Do not commit `remotion/public/william-promise/`. Do not commit anything under `/tmp`.

## What this feature is

Royal v3 turns one script into a timeline where each spoken line is one scene, then a context pass picks a library clip or still for that line. The editor reviews those pictures in the timeline. Rendering plays one media item for the whole scene.

The work so far did three things:

1. Brought six long jobs to the clip-share and reuse bar, then person-checked the frames that were up at audit time.
2. Split one paragraph job (Camilla in tears) into one scene per sentence.
3. Sped six slow voiceovers into 140–145 words per minute and scaled every scene clock by the same ratio, without changing the chosen pictures.

The hold-and-push look for a clip that is shorter than its line was demonstrated with ffmpeg samples. It is not in the renderer.

## Architecture

```
upload script + voiceover
        |
        v
ensureVoiceAlignment          AssemblyAI word times, cached
        |
        v
publishWhisperLineScenes      one script line = one scene
        |                     times from spokenSpansForWindows
        v
assignContextVisuals          GPT plans who to show; code places assets
        |
        v
visual-intelligence-final-assignment   editor source of truth
royal-v2-final-assignment              same scenes, second copy
        |
        v
timeline editor (swap still / Google still)
        |
        v
lock (optional) -> final-timeline hash
        |
        v
Remotion DocumentaryEditComposition
```

Royal v3 is the submit path for these jobs. Royal v2 still exists and shares the lock, library, and timeline editor. `isRoyalFinalNiche` is true for both `Royal v2` and `Royal v3`. An unlocked job renders only after lock, and lock reads `visual-intelligence-final-assignment`. The editor reads that same file through `loadTimelineScenes`.

Scene clocks are the spoken span of the line: first word start through last word end. Pauses stay in the gaps between scenes. `timingsForWindows` is the other helper and it fills those pauses so the timeline is contiguous. Do not use it for these jobs.

A later `retimeJobVoice` pass speeds the audio with ffmpeg `atempo` (pitch unchanged) and multiplies every scene `startTime` / `endTime` by `newDuration / oldSceneSpan`. Gaps shrink with the voice. Pictures, narration, notes, and `alternativeAssetIds` are not rewritten except that their time fields move.

## File map

| Path | Role |
|---|---|
| `server/visualIntelligence/royalV3/pipeline.ts` | `runRoyalV3Pipeline`: align, publish line scenes, assign visuals |
| `server/visualIntelligence/voiceAlignment.ts` | `ensureVoiceAlignment`, `spokenSpansForWindows`, `timingsForWindows`, `tokenizeScript` |
| `server/visualIntelligence/whisperLineScenes.ts` | `publishWhisperLineScenes`, `splitParagraphSentences`, `splitJobParagraphsIntoSentences` |
| `server/visualIntelligence/royalV2/contextVisualAssign.ts` | `assignContextVisuals`, clip share, reuse, `covers()` |
| `server/visualIntelligence/royalV2/taxonomy.ts` | `canonicalRoyalPerson`, `royalPersonMentions`, `classifyRoyalBeat` |
| `server/visualIntelligence/royalV2/library.ts` | `loadRoyalLibraryAssets`, `royalAssetUrl`, `searchRoyalLibrary` |
| `server/visualIntelligence/royalV2/lock.ts` | `lockRoyalV2Timeline`, `royalTimelineHash`, `loadVerifiedRoyalV2Timeline` |
| `server/visualIntelligence/timelineEditor.ts` | `loadTimelineScenes`, `swapSceneVisual`, `applyWebStill`, `patchTimelineScenes` |
| `server/visualIntelligence/retimeVoice.ts` | `retimeJobVoice` |
| `server/visualIntelligence/knowledgeEditorRoutes.ts` | `GET/PATCH /api/jobs/:id/timeline`, swap, Google still |
| `server/visualIntelligence/royalV2/editorSearch.ts` | library search and Google image search routes |
| `server/index.ts` | `POST /api/jobs/:id/retime-voice`, `POST /api/jobs/:id/split-paragraph-scenes`, `DELETE /api/jobs/:id` |
| `server/render/renderJob.ts` | locked Royal timeline is what render uses |
| `server/render/remotionRender.ts` | one `videoUrl` or still per scene; the second clip is not sequenced |
| `remotion/DocumentaryEditComposition.tsx` | `SceneMedia`: `OffthreadVideo` for the whole scene; Ken Burns on stills only |
| `shared/visualIntelligence.ts` | `TimelineScene`, `JobRecord`, `WORDS_PER_MINUTE = 150`, `isRoyalFinalNiche` |
| `server/storage.ts` | `jobDir`, `jobDataFile`, `saveJob`, `listJobs` |

`PATCH /api/jobs/:id/timeline` only updates notes, revise flags, and effect presets. It cannot change `startTime`. Swaps on one job must be serial. `swapSceneVisual` clears `alternativeAssetIds`.

### Placement rules in code

In `contextVisualAssign.ts`:

- `MIN_REUSE_GAP_SEC = 8 * 60`
- `MAX_USES = 2`
- `MAX_UNIQUE_CLIPS = 120`
- `CLIP_SHARE_LOW = 0.4`, `CLIP_SHARE_HIGH = 0.6`
- `covers(asset, target)` is true when clip length is between `target * 0.85` and `target * 1.4`
- `sameShot` matches asset id, file, content hash, or five shared description tokens of the same person
- `longScene` means `duration > 5`
- A hold note is written only after a clip already passed `covers()` and `clipDuration + 0.15 < scene.duration`
- If no covering clip and the line is not long, the packer looks for two clips that each cover half the line, then a still, then leaves the scene empty with “No library asset passed the reuse and subject rules”
- Model for the plan step: `ROYAL_REASONING_MODEL` or `gpt-6.1-sol`
- ContactBox streaming chat completions, `response_format: json_object`. Do not switch that call to a non-streaming client.

`covers(4.5)` needs about 3.825–6.3s. A 3.7s clip fails. It is also too long to be either half of a 4.5s line (half cover is about 1.91–3.15s), so the packer skips it and falls through to a still. The hold note is never written for that clip.

### What the renderer does with a short clip

`SceneMedia` plays one `OffthreadVideo` for `durationInFrames`. There is no freeze of the last frame and no push-in on video. Stills can Ken Burns via `cameraMotion`. `alternativeAssetIds[0]` is exposed as `secondPreviewUrl` in the editor. `effectPlanner` can use that second asset as a split-comparison still. It is not a time split of two clips.

### Retime endpoint

`POST /api/jobs/:jobId/retime-voice` with optional `{ "targetWpm": 142.5 }`. The target must be from 140 to 145 inclusive. Default is 142.5.

Behavior:

- Probe the voice file. Words come from the alignment, else `voiceAlignmentWordCount`, else the script.
- If words per minute are already in band and the last scene end is within 1 second of the file, return without writing.
- Otherwise ffmpeg `atempo` to `words * 60 / targetWpm`. One correction pass if the result falls outside the band. Speed must stay between 0.5 and 2.
- Backup the original once, beside the file, named `{voiceoverPath}.before-wpm-retime`. Do not overwrite that backup.
- Scale scenes in `visual-intelligence-final-assignment`, `royal-v2-final-assignment`, and `final-timeline` if that file has scenes. Each file is scaled from its own span, so a retry does not shrink twice.
- Scale alignment word `start` / `end` the same way.
- Scale `effect-timeline`, `royal-v2-sfx-plan`, `royal-v2-music-plan`, `royal-v2-glitch-plan` when those event lists exist.
- Set `job.voiceoverDurationSec` from the probed file.
- If the timeline is locked, recompute `royalTimelineHash` so lock still matches.
- Refuse while status is `rendering` or `analyzing_full_script`.

`ensureVoiceAlignment` treats a cache as valid when status is ready, the voice path is unchanged, and the script word count matches. Scaled words stay cached. A new transcription starts only if the path or the script length changes. Do not point `voiceoverPath` at the backup.

`cacheMatches` does not compare duration. After a retime, do not call `assignContextVisuals` or `splitJobParagraphsIntoSentences` on that job. Either one rebuilds scenes and will replace the pictures.

## Editorial bar (set by the editor, not all of it is in code)

One physical script line is one scene. Do not merge or split lines, except a period jammed against the next capital. The Camilla-in-tears job was the exception: its saved “lines” were paragraphs, and the editor ordered a sentence split.

Scene timing is the spoken span. Do not round a card to a whole second. Tiny overlaps under about 0.08s are snapped. The sentence splitter trims overlaps up to 0.3s.

Clip share: strictly more than 40 percent of scenes should be raw or trusted clips. Do not force an exact number inside 40–60 percent. Unique clips per video stay around 100–120 and must not pass 120. A clip may be used twice, and the second use must be at least 8 minutes later, including lookalikes. Nothing three times. No back-to-back repeats.

Length rule the editor first set: if a scene is 4 seconds, use a clip within about plus or minus 0.5 seconds. A longer clip can be trimmed. Do not freeze more than about 0.5 seconds. That rule was relaxed for Camilla in tears while lines were ~16s paragraphs and clips maxed near 6s. After the sentence split, lines are ~5s again, but the library does not have enough unique clips of that length.

Agreed fill, for a clip already in the edit, and not yet implemented:

- Play at normal speed. Do not slow the clip.
- If the hole is under about 1 second, hold the last frame and add a slow push-in.
- If the hole is longer than 1 second, cut in a second clip of the same person, or use a photograph.
- Do not stretch one short clip across the whole line.
- Do not borrow the next line’s picture.
- A 3.7s clip on a 4.5s line (0.8s short) is a hold, not a second clip.

Generic versus specific: a specific event, death, birth, or article gets a library image, or Google if the library does not have it. Generic lines show that person with a clip. Clips are not limited to the title person. Charles, Camilla, William, and Anne clips can be used when the sentence is about them. For a letter or envelope line, showing the person the document is about is correct. Three consecutive lines are one thought. Context resolves pronouns. A new person starts a new shot. Do not paste the previous faces onto the next line. Do not cut faces in half. No toddler when the line is an older child or adult. Charles Spencer is not King Charles. Camilla’s daughter is Laura Lopes. Camilla’s son is Tom Parker Bowles.

Human review bar they accepted: the person is right (actor, both people, right age). A walk, speech, or portrait of the right person stays. Fail a wrong person, half of a named pair, a missing specific thing (jewel, letter, death, dated event), a collage, or a watermark. Minor mood can stay. 95 percent means about 20 scenes an editor would still reject on a 400-scene video, scored on the saved frame, not the library label.

Do not add packer rules or train a model until the editor has liked many fixed videos. Learning notes stay under `/tmp`. Picture swaps are not a pull request. Do not change `PIPELINE_WORKER_CONCURRENCY` (default 4).

Google stills, if used again: SearchAPI, the typed query only, first ~30–40 images, no size, aspect, safe, or num filters. Prefer landscape. Skip Pinterest, Shutterstock, Alamy, TikTok, Instagram, Facebook, Getty, and iStock. A chosen image must preview from the saved `/media` file. Do not fill a miss with the wrong person.

## Library shape (measured, not a live query)

Across 753 clips: p10 3.0s, p50 3.3s, p90 4.84s, min 2.07s, max 6.27s. Largest pools, median then max: Catherine 131 (3.20 / 5.31), Harry 125 (3.67 / 6.27), Diana 97 (3.68 / 5.64), Meghan 92 (3.00 / 5.00), Charles 91 (3.48 / 6.05), William 89 (3.20 / 5.68), Camilla 88 (3.30 / 5.82), Anne 40 (3.00 / 5.57).

Public clip base: `https://pub-0ae6bea3eabc4a8db3932d8674ab8c01.r2.dev`. Stills in the editor are often relative `/api/media-library/asset?key=...` and need the session cookie.

## Completed work

### Six jobs brought to the clip bar

All were `scene_review_ready` before the later voice speed-up. Counts below are the picture pass, before retiming. After retiming, scene counts and picture ids are the same; only times and the voice file changed. Unique clips stayed at or under 120. Back-to-back repeats, third uses, second uses under 8 minutes, and empty scenes were cleared on these six. A picture may still appear twice.

| Job | Id | Clips | Notes |
|---|---|---|---|
| V2 - Princess Anne BLOCKS Camilla’s Final Move | `5e23c709-30c2-49e4-ab03-776818865bbb` | 124/308 = 40.3%, unique 94 | 22 bad frames swapped. Five extra clips added to clear 40%. |
| Queen Camilla IN TEARS | `c78580e5-a55a-4abc-ae9e-1268b37f66f1` | 129/299 = 43.1%, unique 116 | Was 97 paragraphs. Sentence-split to 299. 30 bad frames swapped. Do not split again. |
| Princess Catherine HUMILIATES Camilla’s Daughter | `f3818154-9e0e-4384-a525-9432a71743c2` | 116/288 = 40.3%, unique 77 | 49 long holds added because Catherine clips max ~5.31s. Two of those failed a later line check and were replaced. This job is no longer on the live job list. |
| CAMILLA IN BIG TROUBLE | `735e3031-79c0-4d1d-aff8-818736c8d7aa` | 108/269 = 40.1%, unique 77 | 19 bad frames swapped. |
| William BLOCKS Camilla’s Jewel Demand | `9de66466-9a21-46e4-a22a-b5a82890371a` | 209/458 = 45.6%, unique 120 | At the unique-clip cap. 47 bad, 43 swapped. Google stills on scenes 345, 446, 451, 452, 453, 455. Scene 308 left as Catherine wearing Diana’s sapphire even though a checker said it should be Diana. `finish-summary.json` for this job is stale. |
| Royal Family STUNNED As Diana's Lawyers Confirm Her Secret Letter | `0ca290fe-052f-471e-9cbc-a7217cc2f3ed` | 137/311 = 44.1%, unique 120 | 32 bad frames swapped. |

First-pass “good” rates before those replacements, scored on the picture that was up then: tears 269/299, Anne blocks 286/308, Catherine 256/288 plus 2 later fails in the 49 long clips, trouble 250/269, jewel 411/458, letter 279/311. Combined about 182/1933, or 90.6 percent. Replacements were mostly person-checked only, not a second full line pass. Do not quote 95 percent as a measured live-frame score.

Also on the live list, not part of that six-job pass:

- Harry And Meghan SHOCK The World, `8817cc65-3afc-4138-88e9-c4988f546a92`. Fixed earlier. Do not re-fix the pictures.
- Princess Anne BREAKS Silence, `3f6252a9-0b90-4e36-a0f5-a4fb70d1a0cb`. Older hand-fixed pictures. The voice was sped on 8 Oct 2026. Do not reshuffle the pictures.

Older jobs the editor had said not to touch, then later ordered deleted. They are gone from the live list, including reports (`DELETE /api/jobs/:id?purgeReports=1`):

- The Promise William Refused, `e29df1e6-4136-4280-ade1-ace221d367ef` (1:49)
- Whisper Probe Royal, `6057f312-12d3-461d-9585-aea20268264a` (12s)
- Whisper Connectivity Probe, `e35170ba-728b-4201-b69d-666331310d96` (5s)

### Voice speed-up on 8 Oct 2026

Target 142.5 wpm. Every scene start and end moved. Zero picture, narration, or note changes. Verified against a before-snapshot of all six timelines.

| Job | Id | Before | After | Scenes moved |
|---|---|---|---|---|
| William & Catherine Shares DEVASTATING Message | `0a238766-bbde-4d65-b5bd-c9ddcc4d0f7f` | 28:15 at 118.7 | 23:31 at 142.5 | 371/371 |
| Princess Anne BLOCKS Camilla’s Final Move | `5e23c709-30c2-49e4-ab03-776818865bbb` | 30:28 at 119.6 | 25:34 at 142.5 | 308/308 |
| Diana’s Lawyers / secret letter | `0ca290fe-052f-471e-9cbc-a7217cc2f3ed` | 20:52 at 123.0 | 18:00 at 142.5 | 311/311 |
| Harry And Meghan SHOCK The World | `8817cc65-3afc-4138-88e9-c4988f546a92` | 22:48 at 124.3 | 19:54 at 142.5 | 352/352 |
| CAMILLA IN BIG TROUBLE | `735e3031-79c0-4d1d-aff8-818736c8d7aa` | 24:49 at 127.6 | 22:14 at 142.5 | 269/269 |
| Princess Anne BREAKS Silence | `3f6252a9-0b90-4e36-a0f5-a4fb70d1a0cb` | 23:46 at 129.2 | 21:33 at 142.5 | 263/263 |

End-time ratios were uniform per job (about 0.833, 0.840, 0.863, 0.873, 0.896, 0.907). Calling the endpoint again on these six is a no-op while the file and the scene span stay in band.

Left alone on purpose:

- Queen Camilla IN TEARS was already about 141 wpm. Not in the speed-up list.
- William BLOCKS Camilla’s Jewel Demand was about 138 wpm. Not in the list. It is still the slower of the two remaining full jobs that were not sped.

### Hold and slow-down samples

These are local ffmpeg samples, not editor output. Artifacts are immutable; do not overwrite them.

Shown and reviewed:

- `/opt/cursor/artifacts/three_second_harry_clip_then_held_push.mp4` — 3.0s of Prince Harry trusted 0007 (1920x1080) then 1.0s last-frame push. Motion, then a clean freeze, then a visible push. Source clip was 3.5s at `library/royal-family/prince-harry/trusted/royal-family-prince-harry-trusted-0007.mp4`.
- `/opt/cursor/artifacts/hold_one_second_first_then_three_second_play.mp4` — 1s push on the opening frame, then the 3s clip. The join snaps from the tightened crop back to the wide moving shot.
- `/opt/cursor/artifacts/three_second_clip_slowed_by_25_percent.mp4` — the same 3s clip at 0.75x, so 4.0s, no freeze. `setpts=PTS/0.75` slows the video. `setpts=PTS*0.75` would speed it up.

Do not show these failed or misleading files:

- `/opt/cursor/artifacts/last_second_hold_slow_push.mp4` and `three_point_five_clip_then_one_second_hold.mp4` — freeze with no zoom, from `zoompan=z='1+0.07*on/29'`. On a looped still, `on` does not advance.
- Anything under `/tmp/hold3/`. That used King Charles raw 0011, which is 640x360 and 2.97s.

Working still push: scale the frame to 3840 wide, then `zoompan=z='min(zoom+0.005,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=30:s=1920x1080:fps=30`. A real push shows up as a finite PSNR between the first and last frame (about 17–19 for this amount of zoom). A video reviewer twice reported “no zoom” on files whose stills and PSNR showed a tighter crop. Trust the stills and PSNR.

The editor has not accepted this look, so it must not be added to Remotion until they ask.

## Decisions and why

- Spoken spans, not filled pauses. The editor wants the card to match the words, not the silence around them.
- Strictly more than 40 percent clips, not exactly 40. `floor(n * 0.40) + 1` was the finish target.
- Speed the voiceover to 142.5 wpm instead of padding pictures. The six named jobs were 119–129 wpm against a 150 wpm planning constant. The editor asked for at least 140 and not past 145. 142.5 sits inside that band after ffmpeg duration error.
- Scale scene times instead of re-running the packer. Re-running `assignContextVisuals` would replace pictures. The editor said the selected and replaced scenes must stay.
- `atempo`, not a resample that changes pitch. The same recording plays faster.
- Backup before replace, and scale each JSON file from its own span. A failed request can be retried without speeding the file twice or shrinking scenes twice.
- Sentence-split only the tears job. Other jobs were already one line per scene.
- Leave jewel scene 308 as Catherine wearing the sapphire. The sentence is about the ring already being hers publicly.
- Do not train, and do not add an automatic vision gate, until the editor has accepted a style on videos they would ship. Text rules did not move a ~91 percent first pass to 95 percent.
- Picture work for the six jobs was production API swaps, not a pull request. The sentence split and the retime endpoint are the code changes.

## Constraints

- Railway project `09c7240d-5867-49ae-bddb-446d19a8ec1b`, environment `def15ce7-b17b-4998-9008-be2d138799cf`, service `8b47387b-9a3e-48de-af46-c9d08bb2bfec`. Volume mount `/data`. GraphQL `https://backboard.railway.com/graphql/v2` needs a browser User-Agent. Deploy with `serviceInstanceDeploy(serviceId, environmentId, commitSha)`. Do not call `serviceInstanceRedeploy`. `variableUpsert` without `skipDeploys: true` redeploys.
- The service builder enum has no `DOCKERFILE` value. Set `railwayConfigFile` to `/railway.toml`. That file selects the Dockerfile, ffmpeg, and `/api/health`. A deploy can report builder `RAILPACK` in metadata while the build log is still the Dockerfile `apt-get install ffmpeg` steps. Confirm logs before cancelling a build.
- GitHub Actions `RAILWAY_TOKEN` is empty, so a push to `main` does not redeploy.
- Railway CLI SSH with the project token is unauthorized. There is no shell on the volume from this environment. File changes on `/data` go through the app or a deployed endpoint.
- AssemblyAI is connected. `ASSEMBLYAI_API_KEY` is set locally and on production. `VOICE_ALIGNMENT` is on. Default speech model is `universal-3-5-pro`. A `GET /v2/transcript?limit=1` with the local key returned 200 on 8 Oct 2026. Code lives in `voiceAlignment.ts` (`ASSEMBLY_BASE`, `assemblyApiKey`, `assemblyModel`).
- Login is `POST /api/auth/login`, cookie `dvf_session`. Credentials are not stored in this file.
- Swaps on the same job are serial. Do not share-write `/tmp/broll/vision-cache.json` from two processes.
- `PIPELINE_WORKER_CONCURRENCY` stays at the default 4.
- Do not hand-pick visuals as the general method. The temporary passes were editor cleanup, not the packer.

## Current bugs and gaps

- The product does not hold the last frame or push in. Editor notes that say “Hold the last frame” are text only. Remotion keeps playing or freezing the video decoder’s last frame with no designed push.
- Two-clip scenes are stored and labeled in the editor. The renderer does not play the second clip as the back half of the line.
- `covers()` drops a clip that is only a little shorter than the line, so the 3.7s-on-4.5s case never reaches the hold note.
- `swapSceneVisual` wipes `alternativeAssetIds`, so a two-clip placement cannot be created from the swap API.
- First-pass vision was about 91 percent good, and most replacements were person-checked only. A second full line pass on tears, trouble, letter, and the 22 Anne-blocks swaps was not run.
- Jewel `finish-summary.json` still describes the job from before the manual Google fixes.
- Catherine humiliates (`f3818154`) is not on the live job list anymore. Do not assume its 116/288 result is still editable.
- `ffmpeg` `zoompan` using `on` on a single looped image does not zoom. Use `zoom+` as in the working command above.
- A single-frame `image2` output warns unless `-update 1` is set. The file is still written.
- `ffprobe` accepts one input. Passing two filenames fails before later checks run.
- `server/visualIntelligence/retimeVoice.ts` typechecks. `tsc -p tsconfig.server.json` still fails on older unrelated files (`index.ts` render status `"done"`, prune script, image search unions, mystery intro types). Those failures predate the retime commit.

## Test results

- 8 Oct 2026, after deploy of `33b5a42`: all six retime calls returned `audioReplaced: true`, `scenesScaled: true`, `visualsUnchanged: true`, and about 142.5 wpm. A second read of each timeline matched the before-snapshot on scene id, selected visual, approved visual, alternatives, narration, and notes, and differed on every start and end.
- The three short jobs no longer appear in `GET /api/jobs`. Eight jobs remained: the six sped jobs, Camilla in tears, and the jewel job.
- Hold demo: 3.000s + 1.000s = 4.000s, 120 frames, 1920x1080. Reviewer confirmed motion for 3 seconds, a freeze at 3.0s, and a push that crops the hand at the right edge. PSNR between hold start and hold end was about 17.7.
- Hold-first demo: 4.000s. First second frozen and zoomed. Motion from 1s to 4s. Join PSNR about 17.5, which is the snap back to the wide frame.
- 25 percent slow demo: 4.000s, 120 frames. Frame samples 1 second apart differ (PSNR about 30). A sparse reviewer call that said the clip was frozen was wrong relative to those frames.
- AssemblyAI list-transcripts call: HTTP 200.

Local sample files from that work, not in git: `/tmp/hold-demo/` (Harry 3.5s master), `/tmp/hold4/` (3s plus hold), `/tmp/hold5/` (hold-first and 0.75x). `/tmp/broll/finish.py` and `gap.py` were the one-off picture passes. Do not restart them.

## Exact next steps

1. Do not retime the six jobs again unless a probe shows the file and the scene span have drifted. A second call should no-op.
2. Do not run `assignContextVisuals`, `publishWhisperLineScenes`, or `split-paragraph-scenes` on a retimed job. That rebuilds scenes and drops the saved pictures.
3. Leave Camilla in tears and the jewel job at their current voice speeds unless the editor names them. Jewel is the one still near 138 wpm.
4. If the editor accepts the hold-and-push sample, implement it in `SceneMedia` for a clip shorter than the scene by under about 1 second: play the clip, then hold the last frame with a slow scale. Do not slow the clip. Do not put the effect only in `editorNotes`.
5. If the hole is over about 1 second, the agreed fallback is a second clip of the same person or a still. The renderer has to learn a time split before `alternativeAssetIds` will do that. `swapSceneVisual` must stop clearing that field if two-clip scenes are created from the editor.
6. A 95 percent claim still needs a second vision pass on the live frames of the replacement scenes, plus a human sample. Do not train on the automatic rejects.
7. Style references the editor said they would send have not arrived. Do not invent a style guide past the hold rule they were judging.
8. New production code deploys with `serviceInstanceDeploy` on the commit SHA, with `railwayConfigFile=/railway.toml`, and waits until status is `SUCCESS` and `/api/health` is 200. Confirm the build log is the Dockerfile before treating a `RAILPACK` label as a wrong image.
