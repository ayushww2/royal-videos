/**
 * Smoke / dry-validate RunPod Serverless endpoint.
 *
 * Default: GET endpoint metadata (cheap).
 * --live: submit a tiny smoke job (billable GPU time).
 */
import dotenv from "dotenv";

dotenv.config();

const REST = "https://rest.runpod.io/v1";
const API = "https://api.runpod.ai/v2";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main(): Promise<void> {
  const key = requireEnv("RUNPOD_API_KEY");
  const endpointId = requireEnv("RUNPOD_SERVERLESS_ENDPOINT_ID");
  const live = process.argv.includes("--live");

  const metaRes = await fetch(`${REST}/endpoints/${endpointId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const metaText = await metaRes.text();
  if (!metaRes.ok) {
    throw new Error(`Endpoint GET failed (${metaRes.status}): ${metaText.slice(0, 400)}`);
  }
  const meta = JSON.parse(metaText) as {
    id?: string;
    name?: string;
    workersMax?: number;
    workersMin?: number;
    gpuTypeIds?: string[];
  };
  console.log(
    JSON.stringify(
      {
        ok: true,
        dry: !live,
        endpointId: meta.id || endpointId,
        name: meta.name,
        workersMin: meta.workersMin,
        workersMax: meta.workersMax,
        gpuTypeIds: meta.gpuTypeIds,
      },
      null,
      2
    )
  );

  if (!live) {
    console.log("[smoke] dry OK — pass --live to submit a tiny billable smoke job");
    return;
  }

  const smokeJobId = `smoke-${Date.now().toString(36)}`;
  const runRes = await fetch(`${API}/${endpointId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { jobId: smokeJobId, smoke: true, compositionId: "DocumentaryEdit" },
      policy: { executionTimeout: 1800, ttl: 3600 },
    }),
  });
  const runText = await runRes.text();
  if (!runRes.ok) {
    throw new Error(` /run failed (${runRes.status}): ${runText.slice(0, 400)}`);
  }
  const run = JSON.parse(runText) as { id?: string };
  console.log(`[smoke] submitted runId=${run.id} jobId=${smokeJobId}`);

  const started = Date.now();
  while (Date.now() - started < 25 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    const stRes = await fetch(`${API}/${endpointId}/status/${run.id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const st = (await stRes.json()) as {
      status?: string;
      output?: unknown;
      error?: string;
      progress?: unknown;
    };
    console.log(`[smoke] status=${st.status} progress=${st.progress ?? ""}`);
    if (st.status === "COMPLETED") {
      console.log(JSON.stringify({ ok: true, runId: run.id, jobId: smokeJobId, output: st.output }, null, 2));
      return;
    }
    if (st.status === "FAILED" || st.status === "CANCELLED" || st.status === "TIMED_OUT") {
      throw new Error(`Smoke failed: ${st.status} ${st.error || JSON.stringify(st.output)}`);
    }
  }
  throw new Error("Smoke timed out waiting for COMPLETED");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
