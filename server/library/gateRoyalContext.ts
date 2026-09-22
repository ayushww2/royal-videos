/**
 * ContactBox vision gate for Royal Context Assets — approve before R2 save.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOpenAI } from "../openaiClient.js";
import { config, optionalEnv } from "../config.js";
import type { ContextQueryDef } from "./royalContextQueries.js";

const MODEL = optionalEnv("ROYAL_VISION_MODEL") || config.openaiModel || "gpt-5.6-terra";
const BATCH_SIZE = Math.max(1, Math.min(8, Number(process.env.ROYAL_CONTEXT_VISION_BATCH || 6)));
const PREVIEW_WIDTH = Math.max(160, Number(process.env.ROYAL_VISION_WIDTH || 320));

export type ContextGateRow = {
  index: number;
  ok: boolean;
  rejectReason?: string;
  visualType?: string;
  description?: string;
};

export type ContextGateCandidate = {
  jpeg: Buffer;
  queryDef: ContextQueryDef;
  category: string;
};

function findFfmpeg(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  const line = (which.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (line && fs.existsSync(line)) return line;
  return "ffmpeg";
}

export function toContextJpegPreview(input: Buffer, extHint: string): Buffer {
  if (input.byteLength <= 160_000) return input;
  const ffmpeg = findFfmpeg();
  const tmpIn = path.join(os.tmpdir(), `ctx-in-${process.pid}-${Date.now()}${extHint}`);
  const tmpOut = path.join(os.tmpdir(), `ctx-out-${process.pid}-${Date.now()}.jpg`);
  try {
    fs.writeFileSync(tmpIn, input);
    const res = spawnSync(
      ffmpeg,
      ["-y", "-i", tmpIn, "-vf", `scale='min(${PREVIEW_WIDTH},iw)':-2`, "-q:v", "8", "-frames:v", "1", tmpOut],
      { encoding: "utf8" }
    );
    if (res.status !== 0 || !fs.existsSync(tmpOut)) {
      if (input.length < 500_000) return input;
      throw new Error(res.stderr?.slice(0, 300) || "ffmpeg preview failed");
    }
    return fs.readFileSync(tmpOut);
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }
}

async function gateBatch(
  category: string,
  candidates: ContextGateCandidate[]
): Promise<Map<number, ContextGateRow>> {
  const openai = getOpenAI();
  const hints = candidates
    .map(
      (c, i) =>
        `image ${i}: category="${category}" subcategory="${c.queryDef.subcategory}" visualType="${c.queryDef.visualType}" search="${c.queryDef.query.slice(0, 100)}"`
    )
    .join("\n");

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `UK Royal Family documentary CONTEXT asset gate.

For EACH image (0 .. ${candidates.length - 1}), decide if it should enter a reusable B-roll library.

APPROVE (ok=true) when:
- Landscape or wide documentary-usable composition (16:9 friendly)
- Visually fits British Royal Family documentary context
- Useful as generic context B-roll (documents, palace, press, archive, travel, meetings, memory mood)
- Document/newspaper/headline CONTENT text is fine

REJECT (ok=false) when:
- Watermark, stock-site overlay, meme text, or large baked-in caption overlay (NOT document content)
- Portrait-primary photo of a celebrity/royal face as the main subject (People library handles portraits)
- Clearly US White House / American presidential / unrelated foreign royalty
- Corporate modern office with no royal/documentary relevance
- Broken, tiny, or extremely blurry image
- Obvious duplicate thumbnail / irrelevant search junk

Return JSON only:
{"items":[{"index":0,"ok":true,"rejectReason":null,"visualType":"document","description":"Short factual caption for editors."}]}

Hints:
${hints}`,
    },
  ];

  for (const c of candidates) {
    const b64 = c.jpeg.toString("base64");
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" },
    });
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You gate documentary context stock images for a UK Royal Family editor. Return strict JSON only.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { items?: Array<ContextGateRow & { index?: number }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from context vision gate");
  }

  const out = new Map<number, ContextGateRow>();
  for (let i = 0; i < candidates.length; i++) {
    const row = parsed.items?.find((x) => x.index === i) || parsed.items?.[i] || { index: i, ok: false };
    out.set(i, {
      index: i,
      ok: Boolean(row.ok),
      rejectReason: row.rejectReason ? String(row.rejectReason).slice(0, 120) : undefined,
      visualType: row.visualType ? String(row.visualType).slice(0, 64) : candidates[i].queryDef.visualType,
      description: row.description
        ? String(row.description).trim().slice(0, 220)
        : `${category} context image for UK royal documentary.`,
    });
  }
  return out;
}

/** Vision-gate a batch of downloaded context candidates. */
export async function gateRoyalContextCandidates(
  category: string,
  candidates: ContextGateCandidate[]
): Promise<ContextGateRow[]> {
  if (!candidates.length) return [];
  const rows: ContextGateRow[] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const slice = candidates.slice(i, i + BATCH_SIZE);
    const map = await gateBatch(category, slice);
    for (let j = 0; j < slice.length; j++) {
      rows.push(map.get(j) || { index: i + j, ok: false, rejectReason: "missing gate result" });
    }
  }
  return rows;
}
