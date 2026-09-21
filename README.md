# Royal Videos

Standalone Royal documentary video factory — extracted from `new-video-ai`.

## Includes
- Royal v2 submission + bulk dashboard
- Royal media library (R2 `royal-family`)
- Remotion effects + royal music/SFX
- Soft approval, scene lock, render pipeline
- RunPod / Remotion / Shotstack render paths

## Deploy
Railway service from this repo root (`Dockerfile` + `railway.toml`).

**ContactBox (GPT):** `contactbox.env` in the repo sets `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` (`gpt-5.6-sol`). Railway Variables override when present.

## Auth
- **Ayush (default):** `APP_USERNAME` / `APP_PASSWORD` (defaults `ayush` / `awmedia123`)
- **Adrian (manager):** always enabled — username `adrian`, password `APP_PASSWORD` unless you set `ADRIAN_PASSWORD`
- **Extra accounts:** `APP_LOGINS=user:password,user2:password2`
- Disable Adrian: `ADRIAN_LOGIN=0`

## Cursor
Open this repo in a **new** Cursor chat / Cloud Agent for all future royal work.
