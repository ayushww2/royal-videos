/**
 * ElevenLabs TTS for documentary voiceovers.
 * Defaults: Bill (Social Media) + Turbo v2.5
 */
import fs from "node:fs";
import path from "node:path";
import { getElevenLabsKey, optionalEnv } from "./config.js";

export const ELEVENLABS_VOICES = [
  {
    id: "pqHfZKP75CvOlQylNhV4",
    name: "Bill (Social Media)",
    description: "Friendly American male — social / documentary narration",
  },
] as const;

export const ELEVENLABS_MODELS = [
  {
    id: "eleven_turbo_v2_5",
    name: "Turbo v2.5",
    description: "Fast high-quality narration (default)",
  },
  {
    id: "eleven_multilingual_v2",
    name: "Multilingual v2",
    description: "Premium long-form quality",
  },
  {
    id: "eleven_flash_v2_5",
    name: "Flash v2.5",
    description: "Fastest / cheapest drafts",
  },
  {
    id: "eleven_v3",
    name: "Eleven v3",
    description: "Most expressive / dramatic",
  },
] as const;

export const DEFAULT_ELEVENLABS_VOICE_ID =
  optionalEnv("ELEVENLABS_VOICE_ID") || ELEVENLABS_VOICES[0].id;
export const DEFAULT_ELEVENLABS_MODEL_ID =
  optionalEnv("ELEVENLABS_MODEL_ID") || ELEVENLABS_MODELS[0].id;

const API_BASE = "https://api.elevenlabs.io/v1";
/** Turbo / Flash support large chunks; keep margin under 40k. */
const CHUNK_CHARS = 3500;

export type ElevenLabsGenerateParams = {
  text: string;
  outPath: string;
  voiceId?: string;
  modelId?: string;
};

function splitForTts(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= CHUNK_CHARS) return [cleaned];

  const parts: string[] = [];
  let buf = "";
  const paragraphs = cleaned.split(/\n{2,}|\n/);
  for (const para of paragraphs) {
    const piece = para.trim();
    if (!piece) continue;
    if (!buf) {
      buf = piece;
      continue;
    }
    if (buf.length + 1 + piece.length <= CHUNK_CHARS) {
      buf = `${buf}\n${piece}`;
    } else {
      parts.push(buf);
      buf = piece;
    }
  }
  if (buf) parts.push(buf);

  // Hard-split any oversized leftover paragraphs
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= CHUNK_CHARS) {
      out.push(p);
      continue;
    }
    let i = 0;
    while (i < p.length) {
      let end = Math.min(i + CHUNK_CHARS, p.length);
      if (end < p.length) {
        const slice = p.slice(i, end);
        const soft = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
        if (soft > CHUNK_CHARS * 0.4) end = i + soft + 1;
      }
      out.push(p.slice(i, end).trim());
      i = end;
    }
  }
  return out.filter(Boolean);
}

async function synthesizeChunk(
  apiKey: string,
  voiceId: string,
  modelId: string,
  text: string
): Promise<Buffer> {
  const url = `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 400)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/** Generate an MP3 voiceover from script text. */
export async function generateElevenLabsVoiceover(
  params: ElevenLabsGenerateParams
): Promise<{ voiceId: string; modelId: string; bytes: number; chunks: number }> {
  const apiKey = getElevenLabsKey();
  const voiceId = (params.voiceId || DEFAULT_ELEVENLABS_VOICE_ID).trim();
  const modelId = (params.modelId || DEFAULT_ELEVENLABS_MODEL_ID).trim();
  const chunks = splitForTts(params.text);
  if (!chunks.length) throw new Error("Script is empty — nothing to synthesize");

  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(apiKey, voiceId, modelId, chunk));
  }
  const audio = Buffer.concat(buffers);
  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  fs.writeFileSync(params.outPath, audio);
  return { voiceId, modelId, bytes: audio.length, chunks: chunks.length };
}

export function listElevenLabsOptions() {
  return {
    voices: ELEVENLABS_VOICES.map((v) => ({ ...v })),
    models: ELEVENLABS_MODELS.map((m) => ({ ...m })),
    defaults: {
      voiceId: DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: DEFAULT_ELEVENLABS_MODEL_ID,
    },
    configured: Boolean(optionalEnv("ELEVENLABS_API_KEY")),
  };
}
