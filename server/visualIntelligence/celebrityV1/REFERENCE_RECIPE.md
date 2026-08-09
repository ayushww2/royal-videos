# Celebrity v1 reference edit recipe

Source: [Tp5kwT3785Y](https://www.youtube.com/watch?v=Tp5kwT3785Y) — *Things Aren't Looking Good For Pastor Joel Osteen* (The Unseen).

Measured numbers live in `referenceRecipe.ts` and
`storage/data/celebrity-v1-reference-recipe-Tp5kwT3785Y.json`.

## User approval gate

These defaults are the **permanent Celebrity v1 algorithm**. After you approve:

- Every new Celebrity v1 job uses this pacing / raw% / LT / zoom / safety behavior automatically.
- No per-job toggle is required.
- Env `CELEBRITY_V1_REFERENCE_EDIT` defaults **ON**. Set `false` / `0` / `off` only to disable.

## Measured recipe (9 min sampled: 0–3, 10–13, 20–23)

| Metric | Value |
| --- | --- |
| Cuts / min | ~9.7 opener · ~13 mid · ~11.3 late → **target 11** (band 9–13) |
| Hold length | median **4.4–5.2s**, avg **4.5–6s** (band 3.5–7.5) |
| Raw / motion vs stills | Reference estimate **~55–70%** archival video; practical pipeline target **22–38%** when user YT raw is available |
| Lower thirds | Sparse classic blue name/date plates (~0.4–1.4 / min); frequent small top-left name IDs |
| Zoom | Ken Burns push-in on stills; mild zoom-in on heroes; hard cuts between clips |
| Transitions | **~92% hard cut**, rare framed/split juxtaposition, almost no dissolves |
| Effect density | **~2–3 moments / min** (not packed) |
| Opener | Subject face / interview archival immediately; never wrong person / vulgar gesture |
| Text | Bold white ALL-CAPS captions with black outline; year markers in blue bottom-left boxes |

## Pipeline mapping

- Beat window → `holdSec.target` (5.0s) via editor beats / VO clock
- Raw mix → `rawFootagePercent` band in assemble + `rawMixOptionsFromJob`
- Effects → `celebrityV1/effectRules.ts` (sparse LT, clean zoom, occasional split)
- Remotion stills → Ken Burns zoom in/out from recipe zoom shares
- Safety → shared `contentSafety.ts` + person-lock exact-match rules
