import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { JobRecord } from "../shared/visualIntelligence.js";

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(config.storagePath, { recursive: true });
  await fs.mkdir(config.dataPath, { recursive: true });
  await fs.mkdir(path.join(config.storagePath, "jobs"), { recursive: true });
  await fs.mkdir(path.join(config.storagePath, "renders"), { recursive: true });
  await fs.mkdir(path.join(config.storagePath, "cache"), { recursive: true });
}

export function jobDir(jobId: string): string {
  return path.join(config.storagePath, "jobs", jobId);
}

export function jobDataFile(name: string, jobId: string): string {
  return path.join(config.dataPath, `${name}-job-${jobId}.json`);
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveJob(job: JobRecord): Promise<void> {
  const dir = jobDir(job.jobId);
  await fs.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "job.json"), job);
  await writeJson(path.join(config.dataPath, `job-${job.jobId}.json`), job);
}

export async function loadJob(jobId: string): Promise<JobRecord | null> {
  return readJson<JobRecord>(path.join(jobDir(jobId), "job.json"));
}

export async function listJobs(): Promise<JobRecord[]> {
  const jobsRoot = path.join(config.storagePath, "jobs");
  try {
    const entries = await fs.readdir(jobsRoot, { withFileTypes: true });
    const jobs: JobRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const job = await loadJob(entry.name);
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
