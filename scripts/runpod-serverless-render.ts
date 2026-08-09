/**
 * Remotion render entry for RunPod Serverless workers.
 *
 * Reads JSON input (jobId + inputProps or fetch from app), renders final.mp4,
 * uploads to R2 when configured, else POSTs multipart to Railway complete route.
 *
 * Progress lines (parsed by handler.py):
 *   PROGRESS 0.42
 *   STATUS Uploading to R2
 */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

process.env.REMOTION_LAMBDA = "0";
process.env.RUNPOD_RENDER = "0";
if ((process.env.RENDERER || "").toLowerCase() === "runpod") {
  process.env.RENDERER = "remotion";
}
// Cap concurrency — Railway may set 16 which OOMs short Serverless workers.
{
  const raw = Number(process.env.REMOTION_CONCURRENCY || process.env.RUNPOD_REMOTION_CONCURRENCY || "4");
  const capped = Number.isFinite(raw) ? Math.max(1, Math.min(8, raw)) : 4;
  process.env.REMOTION_CONCURRENCY = String(capped);
}

type InputPayload = {
  jobId: string;
  compositionId?: string;
  inputProps?: Record<string, unknown>;
  propsUrl?: string;
  appBaseUrl?: string;
  workerSecret?: string;
  outputPath: string;
  resultPath: string;
  smoke?: boolean;
};

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

function status(msg: string): void {
  console.log(`STATUS ${msg}`);
}

async function fetchPropsFromApp(
  appBase: string,
  secret: string,
  jobId: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${appBase.replace(/\/$/, "")}/api/render-queue/${jobId}/props`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `fetch props failed (${res.status}): ${typeof json === "object" && json && "error" in json ? String((json as { error: unknown }).error) : text.slice(0, 300)}`
    );
  }
  const props = (json as { inputProps?: Record<string, unknown> })?.inputProps;
  if (!props) throw new Error("props response missing inputProps");
  return props;
}

async function reportProgress(appBase: string, secret: string, jobId: string, progress: number): Promise<void> {
  try {
    await fetch(`${appBase.replace(/\/$/, "")}/api/render-queue/${jobId}/progress`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ progress }),
    });
  } catch {
    // non-fatal
  }
}

async function notifyCompleteUrl(params: {
  appBase: string;
  secret: string;
  jobId: string;
  outputUrl: string;
  r2Key?: string;
  durationInFrames?: number;
}): Promise<void> {
  const res = await fetch(
    `${params.appBase.replace(/\/$/, "")}/api/render-queue/${params.jobId}/complete-url`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        outputUrl: params.outputUrl,
        r2Key: params.r2Key,
        durationInFrames: params.durationInFrames,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`complete-url failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

async function uploadMultipart(params: {
  appBase: string;
  secret: string;
  jobId: string;
  filePath: string;
  durationInFrames?: number;
}): Promise<{ outputUrl?: string; r2Key?: string }> {
  const buf = await fs.readFile(params.filePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), "final.mp4");
  if (params.durationInFrames != null) {
    form.append("durationInFrames", String(params.durationInFrames));
  }
  const res = await fetch(
    `${params.appBase.replace(/\/$/, "")}/api/render-queue/${params.jobId}/complete`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${params.secret}` },
      body: form,
    }
  );
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`complete upload failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return {
    outputUrl: typeof json.outputUrl === "string" ? json.outputUrl : undefined,
    r2Key: typeof json.r2Key === "string" ? json.r2Key : undefined,
  };
}

async function uploadR2(jobId: string, filePath: string): Promise<{ r2Key: string; outputUrl?: string }> {
  const { r2Configured, r2PutObject, mediaLibraryPublicBase } = await import("../server/library/r2.js");
  if (!r2Configured()) throw new Error("R2 not configured");
  const body = await fs.readFile(filePath);
  const r2Key = `renders/${jobId}/final.mp4`;
  await r2PutObject({
    key: r2Key,
    body,
    contentType: "video/mp4",
    metadata: { jobId, renderer: "runpod-serverless" },
  });
  const r2Public = mediaLibraryPublicBase()?.replace(/\/$/, "");
  const outputUrl = r2Public
    ? `${r2Public}/${r2Key.split("/").map(encodeURIComponent).join("/")}`
    : undefined;
  return { r2Key, outputUrl };
}

async function buildSmokeProps(): Promise<Record<string, unknown>> {
  // ~2s smoke with a tiny public JPEG — proves Remotion + handler + (optional) R2 path.
  const imageUrl =
    process.env.SMOKE_IMAGE_URL?.trim() ||
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/320px-Fronalpstock_big.jpg";
  return {
    scenes: [
      {
        sceneId: "smoke-1",
        startTime: 0,
        endTime: 2,
        duration: 2,
        imageUrl,
      },
    ],
    effectEvents: [],
    sfxEvents: [],
    musicEvents: [],
    glitchEvents: [],
    fps: 30,
  };
}

async function main(): Promise<void> {
  const inputFile = argValue("--input");
  if (!inputFile) throw new Error("Usage: runpod-serverless-render.ts --input <path.json>");

  const raw = JSON.parse(await fs.readFile(inputFile, "utf8")) as InputPayload;
  const jobId = raw.jobId;
  if (!jobId) throw new Error("Missing jobId");

  const appBase = (raw.appBaseUrl || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(
    /\/$/,
    ""
  );
  const secret = raw.workerSecret || process.env.RUNPOD_WORKER_SECRET || "";

  let inputProps = raw.inputProps;
  if (!inputProps && raw.smoke) {
    status("Building smoke props");
    inputProps = await buildSmokeProps();
  }
  if (!inputProps) {
    if (!appBase || !secret) {
      throw new Error("No inputProps and cannot fetch (need appBaseUrl + workerSecret)");
    }
    status("Fetching inputProps from app");
    inputProps = await fetchPropsFromApp(appBase, secret, jobId);
  }

  const { renderRemotionMp4 } = await import("../server/render/remotionRender.js");
  const { config } = await import("../server/config.js");

  const outputPath =
    raw.outputPath || path.join(config.storagePath, "renders", jobId, "final.mp4");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  status(`Rendering ${jobId}`);
  let lastPct = -1;
  const result = await renderRemotionMp4({
    jobId,
    outputPath,
    inputProps: inputProps as Parameters<typeof renderRemotionMp4>[0]["inputProps"],
    onProgress: (progress) => {
      const pct = Math.round(progress * 100);
      if (pct >= lastPct + 5 || pct === 100) {
        lastPct = pct;
        console.log(`PROGRESS ${progress}`);
        if (appBase && secret) void reportProgress(appBase, secret, jobId, progress);
      }
    },
  });

  let outputUrl: string | undefined;
  let r2Key: string | undefined;

  const { r2Configured } = await import("../server/library/r2.js");
  if (r2Configured()) {
    status("Uploading to R2");
    const uploaded = await uploadR2(jobId, result.outputPath);
    r2Key = uploaded.r2Key;
    outputUrl = uploaded.outputUrl;
    if (appBase && secret) {
      status("Notifying app complete-url");
      try {
        await notifyCompleteUrl({
          appBase,
          secret,
          jobId,
          outputUrl: outputUrl || `r2://${r2Key}`,
          r2Key,
          durationInFrames: result.durationInFrames,
        });
      } catch (err) {
        // R2 object is already stored — app can still poll RunPod output.
        console.warn(
          "[runpod-serverless-render] complete-url notify failed:",
          err instanceof Error ? err.message : err
        );
      }
    }
  } else if (appBase && secret) {
    status("Uploading MP4 to app");
    const uploaded = await uploadMultipart({
      appBase,
      secret,
      jobId,
      filePath: result.outputPath,
      durationInFrames: result.durationInFrames,
    });
    outputUrl = uploaded.outputUrl;
    r2Key = uploaded.r2Key;
  } else {
    throw new Error("No R2 credentials and no app callback configured");
  }

  const out = {
    ok: true,
    jobId,
    outputUrl,
    r2Key,
    durationInFrames: result.durationInFrames,
    renderer: "runpod-serverless",
  };
  await fs.writeFile(raw.resultPath || path.join(path.dirname(outputPath), "result.json"), JSON.stringify(out), "utf8");
  status("Done");
  console.log(JSON.stringify(out));
}

main().catch((err) => {
  console.error("[runpod-serverless-render] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
