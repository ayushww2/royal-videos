# Mystery v2 — AI image realism recipe (internal tool)

This module does **not** decide what beat/visual to show.
It only engineers **how real** GPT Image 2 stills should look for Mystery documentaries.

## Pipeline

1. **ContactBox** (`OPENAI_API_KEY` + `OPENAI_BASE_URL`) → writes realism prompt pack  
2. **OpenAI Images** (`OPENAI_IMAGE_API_KEY`) → `gpt-image-2`, **low**, **1536x1024** (16:9 landscape)

## Locked look (from reference pack)

References live in `remotion/public/reference/mystery-realism/ref-01.png` … `ref-24.png`.

Target feel:
- Field investigation / archive / lab / underwater exploration stills
- Landscape 16:9 only
- Bright-clear enough to read, but **100% real-looking** with slight human imperfection
- Natural daylight or functional flashlight underwater — not cinematic teal/orange posters
- Grain, soft focus, haze, backscatter, uneven exposure when appropriate
- No glossy AI art, no logos, no fake stamps/timestamps, no readable fake documents

## API

`POST /api/mystery-v2/realism/generate`

```json
{
  "option": "mystery-v2",
  "source": "realism",
  "title": "optional video title",
  "visualIdea": "required: what the still depicts",
  "intendedUse": "hook | reveal | evidence | ending | …",
  "preferredStyle": "color documentary | archive | field evidence | …",
  "aspectRatio": "16:9",
  "realismLevel": "very realistic",
  "generateImage": true
}
```

`source` options for the Mystery v2 image tool:
- `realism` (default) — ContactBox prompt + GPT Image 2
- `pexels` — stock search via `PEXELS_API_KEY`
- `free_stock` — Pexels + Pixabay

See also `PACK.md` for Shotstack documentary pack presets + FX.