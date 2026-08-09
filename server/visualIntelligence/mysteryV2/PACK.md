# Mystery v2 pack

Primary renderer: **RunPod Remotion** (`getRendererForJob("Mystery v2")` → always `runpod`).

Shotstack pack **preview** render (`POST /api/mystery-v2/pack/render`) is **disabled** (410). Catalog JSON under `shotstackPack/templates/` remains reference-only for FX density ideas.

## Job final render

`POST /api/jobs/:jobId/render` → `queueRunpodRender` (images-only harden + R2 mirror).

## Pack presets (catalog only)

| Id | Role |
| --- | --- |
| `01_classic_blue_white_lower_third` | Lower third |
| `02_secondary_blue_lower_third` | Lower third |
| `03_simple_text_overlay` | Text |
| glass / archive / question / red grid / quote | Remotion presets in production pack |

## Related APIs

- `GET /api/mystery-v2/pack` — presets + FX + overlays (`renderer: runpod`)
- `POST /api/mystery-v2/pack/render` — **disabled** (use job render)
- `POST /api/mystery-v2/realism/generate` — `{ visualIdea, source?: "realism"|"pexels"|"free_stock" }`
- `GET /api/mystery-v2/fx`
