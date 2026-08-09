import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { createReadStream } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import { optionalEnv, requireEnv } from "../config.js";

let client: S3Client | null = null;

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET?.trim() &&
      process.env.R2_ENDPOINT?.trim()
  );
}

export function getR2Client(): S3Client {
  if (!client) {
    const maxSockets = Math.max(50, Number(process.env.R2_MAX_SOCKETS || 200));
    client = new S3Client({
      region: "auto",
      endpoint: requireEnv("R2_ENDPOINT"),
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
      requestHandler: new NodeHttpHandler({
        httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets }),
        throwOnRequestTimeout: true,
        // Heavy parallel library jobs need a longer connect window than the default 10s.
        connectionTimeout: Math.max(10_000, Number(process.env.R2_CONNECTION_TIMEOUT_MS || 45_000)),
        requestTimeout: Math.max(60_000, Number(process.env.R2_REQUEST_TIMEOUT_MS || 180_000)),
      }),
    });
  }
  return client;
}

export function r2Bucket(): string {
  return requireEnv("R2_BUCKET");
}

export async function r2PutObject(params: {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata,
    })
  );
  return params.key;
}

/** Stream a local file to R2 (multipart). Used by RunPod worker for final.mp4. */
export async function r2UploadFileFromPath(params: {
  key: string;
  filePath: string;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  const client = getR2Client();
  const upload = new Upload({
    client,
    params: {
      Bucket: r2Bucket(),
      Key: params.key,
      Body: createReadStream(params.filePath),
      ContentType: params.contentType,
      Metadata: params.metadata,
    },
    queueSize: 4,
    partSize: 64 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
  return params.key;
}

export async function r2GetObjectBuffer(key: string): Promise<{ body: Buffer; contentType?: string }> {
  const client = getR2Client();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
    })
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty R2 object: ${key}`);
  return { body: Buffer.from(bytes), contentType: res.ContentType };
}

export async function r2GetJson<T>(key: string): Promise<T | null> {
  try {
    const { body } = await r2GetObjectBuffer(key);
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function r2DeleteObject(key: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
    })
  );
}

export async function r2PutJson(key: string, data: unknown): Promise<void> {
  await r2PutObject({
    key,
    body: Buffer.from(JSON.stringify(data, null, 2), "utf8"),
    contentType: "application/json",
  });
}

export async function r2ListPrefix(prefix: string): Promise<string[]> {
  const client = getR2Client();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: r2Bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export function mediaLibraryPublicBase(): string | undefined {
  return optionalEnv("R2_PUBLIC_URL") || optionalEnv("PUBLIC_APP_URL");
}
