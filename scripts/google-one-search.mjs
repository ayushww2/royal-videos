import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const query = "moving stone door";
const outDir = path.resolve("storage/google-test-moving-stone-door");
fs.mkdirSync(outDir, { recursive: true });

const apiKey = process.env.SEARCHAPI_API_KEY;
const url = new URL("https://www.searchapi.io/api/v1/search");
url.searchParams.set("engine", "google_images");
url.searchParams.set("q", query);
url.searchParams.set("api_key", apiKey);
url.searchParams.set("hl", "en");
url.searchParams.set("gl", "us");
url.searchParams.set("safe", "active");
url.searchParams.set("size", "large");

console.log("SEARCHES=1");
const res = await fetch(url);
const data = await res.json();
fs.writeFileSync(path.join(outDir, "search-response.json"), JSON.stringify(data, null, 2));
const images = (data.images || []).slice(0, 10);

async function download(link, file) {
  const imgRes = await fetch(link, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: "https://www.google.com/",
    },
    redirect: "follow",
  });
  if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length < 1500) throw new Error(`too small (${buf.length}B)`);
  fs.writeFileSync(file, buf);
  return buf.length;
}

const manifest = [];
for (let i = 0; i < images.length; i++) {
  const img = images[i];
  const file = path.join(outDir, `${String(i + 1).padStart(2, "0")}.jpg`);
  const candidates = [img.original?.link, img.thumbnail].filter(Boolean);
  let ok = false;
  let used = null;
  let bytes = 0;
  let error = null;
  for (const link of candidates) {
    try {
      bytes = await download(link, file);
      ok = true;
      used = link;
      break;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  console.log(ok ? `OK ${i + 1} ${bytes}B` : `FAIL ${i + 1} ${error}`);
  manifest.push({
    n: i + 1,
    title: img.title,
    source: img.source?.name,
    url: used || img.original?.link,
    file,
    ok,
    bytes,
    error: ok ? undefined : error,
  });
}

fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify({ query, searches: 1, selected: 10, manifest }, null, 2)
);
console.log("DONE");
