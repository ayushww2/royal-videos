import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** One Word paragraph becomes one script line. Empty paragraphs are dropped. */
export function docxToScript(filePath: string): string {
  const xml = execFileSync("unzip", ["-p", filePath, "word/document.xml"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const paragraphs = xml.split(/<w:p[ >]/).slice(1);
  const lines = paragraphs
    .map((paragraph) => {
      const bits = [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
      return decodeXml(bits.join("")).replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
  return lines.join("\n");
}

export function scriptFromUpload(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") return docxToScript(filePath);
  return fs.readFileSync(filePath, "utf8");
}
