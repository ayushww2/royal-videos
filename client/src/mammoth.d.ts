declare module "mammoth" {
  export function extractRawText(input: {
    buffer?: Buffer;
    arrayBuffer?: ArrayBuffer;
  }): Promise<{ value: string; messages: unknown[] }>;
}
