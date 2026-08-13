# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
Royal Videos — a standalone documentary video factory. Two dev processes run together:
- Express API server (`server/index.ts`, port `3000`) — run via `tsx` (no compile step).
- Vite + React client (`client/`, port `5173`) — proxies `/api` and `/media` to the server (see `client/vite.config.ts`).

Standard commands live in `package.json` scripts. Key ones:
- `npm run dev` — starts BOTH server and client (via `concurrently`). Use this to run the app.
- `npm run dev:server` / `npm run dev:client` — run each half separately.
- `npm run typecheck` — TypeScript-only check (there is no ESLint/Prettier config; this is the closest "lint").
- `npm run build` — builds the client bundle only (`vite build`); the server always runs from source via `tsx`.
- `npm run dev:remotion` — opens Remotion Studio for the video compositions.

### Non-obvious setup / run notes
- A `.env` is required at the repo root for `dotenv` (`server/config.ts` calls `dotenv.config()`). Copy `.env.example` to `.env`. The app boots fine with empty keys.
- Auth is built-in with defaults: username `ayush`, password `awmedia123` (see `server/auth.ts`; override with `APP_USERNAME` / `APP_PASSWORD`). The whole UI is behind a login gate.
- The server starts and serves the UI **without** any API keys — it only logs `WARNING: missing API keys`. `GET /api/health` returns `ok:false` with the missing list, which is expected until keys are set.
- The core pipeline (creating a documentary job via `POST /api/jobs`) is hard-gated: it returns `400 Missing required API keys` unless `OPENAI_API_KEY` and `SEARCHAPI_API_KEY` are set. `OPENAI_API_KEY` targets an OpenAI-compatible proxy (`OPENAI_BASE_URL`, default `https://api.contactboxtools.me/v1`), not necessarily api.openai.com. Additional features need more keys: ElevenLabs (voiceover), R2 (media library / `royal-family` bucket), Shotstack/Remotion/RunPod (final MP4 render). These are all external, paid services — add them as Cloud Agent secrets when you need to exercise those flows.
- `npm run typecheck` currently reports pre-existing type errors in the committed code (e.g. in `server/visualIntelligence/**`). These do NOT block running the app because it runs through `tsx` (no typecheck at runtime). Don't treat these as regressions introduced by your changes — verify against the base branch first.
- In dev, open the client at `http://localhost:5173` (not `:3000`). The Express server only serves the SPA when a production `client/dist` build exists.
