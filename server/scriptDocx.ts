import mammoth from "mammoth";

export function isDocxUpload(filename: string): boolean {
  return filename.toLowerCase().endsWith(".docx");
}

/** Plain text from a .docx, with one paragraph per line. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}
