import dotenv from "dotenv";
dotenv.config();
import fs from "node:fs";
import {
  loadAllMysteryPackTemplates,
  buildMysteryPackEdit,
} from "../server/visualIntelligence/mysteryV2/packLoader.js";
import {
  MYSTERY_V2_SHOTSTACK_EFFECTS,
  MYSTERY_V2_SHOTSTACK_FILTERS,
  MYSTERY_V2_SHOTSTACK_TRANSITIONS,
} from "../server/visualIntelligence/mysteryV2/fxRecipe.js";
import { MYSTERY_V2_OVERLAYS } from "../server/visualIntelligence/mysteryV2/overlayCatalog.js";

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];
const ok = (name: string, pass: boolean, detail?: string) =>
  checks.push({ name, pass: !!pass, detail });

async function main() {
  ok("SHOTSTACK_API_KEY", Boolean(process.env.SHOTSTACK_API_KEY?.trim()));
  ok(
    "SHOTSTACK stage URL",
    (process.env.SHOTSTACK_API_URL || "").includes("stage"),
    process.env.SHOTSTACK_API_URL
  );
  ok("RENDERER=shotstack", process.env.RENDERER === "shotstack", process.env.RENDERER);
  ok("R2_PUBLIC_URL", Boolean(process.env.R2_PUBLIC_URL?.trim()));
  ok("OPENAI_IMAGE_API_KEY", Boolean(process.env.OPENAI_IMAGE_API_KEY?.trim()));
  ok(
    "PEXELS_API_KEY",
    Boolean(process.env.PEXELS_API_KEY?.trim()),
    process.env.PEXELS_API_KEY?.trim() ? "set" : "missing — pexels source blocked until set"
  );
  ok(
    "PIXABAY_API_KEY",
    Boolean(process.env.PIXABAY_API_KEY?.trim()),
    process.env.PIXABAY_API_KEY?.trim() ? "set" : "missing (optional)"
  );

  const tpls = fs
    .readdirSync("server/visualIntelligence/mysteryV2/shotstackPack/templates")
    .filter((f) => f.endsWith(".json"));
  ok("9 pack templates on disk", tpls.length === 9, String(tpls.length));
  ok(
    "FX catalog 5+2+5",
    MYSTERY_V2_SHOTSTACK_EFFECTS.length === 5 &&
      MYSTERY_V2_SHOTSTACK_FILTERS.length === 2 &&
      MYSTERY_V2_SHOTSTACK_TRANSITIONS.length === 5
  );
  ok("10 overlays", MYSTERY_V2_OVERLAYS.length === 10, String(MYSTERY_V2_OVERLAYS.length));

  const summary = JSON.parse(
    fs.readFileSync("storage/previews/mystery-v2-pack/render-summary.json", "utf8")
  ) as { results: Array<{ presetId: string; status: string; renderId: string; url: string }> };
  const done = (summary.results || []).filter((r) => r.status === "done");
  ok("9/9 stage renders recorded", done.length === 9, `${done.length}/9`);

  const base = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  const head = await fetch(`${base}/overlays/transitions/preview-stills/a.png`, { method: "HEAD" });
  ok("R2 stills public HTTPS", head.ok, String(head.status));

  const last = done.find((r) => r.presetId === "03_reveal_mystery") || done[done.length - 1];
  const statusUrl =
    (process.env.SHOTSTACK_API_URL || "https://api.shotstack.io/edit/stage/render").replace(
      /\/$/,
      ""
    ) +
    "/" +
    last.renderId;
  const st = await fetch(statusUrl, {
    headers: { Accept: "application/json", "x-api-key": process.env.SHOTSTACK_API_KEY! },
  });
  const sj = (await st.json()) as { response?: { status?: string } };
  ok("Shotstack API + last render done", st.ok && sj.response?.status === "done", sj.response?.status);

  // Spot-check one MP4 is still fetchable
  const mp4 = await fetch(last.url, { method: "HEAD" });
  ok("Sample MP4 still downloadable", mp4.ok, String(mp4.status));

  const loaded = loadAllMysteryPackTemplates();
  ok("pack loader loads all", loaded.length === 9);

  const side = buildMysteryPackEdit("08_side_by_side_black_white_border", {
    LEFT_IMAGE: `${base}/overlays/transitions/preview-stills/a.png`,
    RIGHT_IMAGE: `${base}/overlays/transitions/preview-stills/b.png`,
  });
  const imgTracks = side.timeline.tracks.filter((t) =>
    t.clips.some((c) => (c.asset as { type?: string } | undefined)?.type === "image")
  );
  ok("side-by-side non-overlapping tracks", imgTracks.length === 2, `imageTracks=${imgTracks.length}`);

  const glass = buildMysteryPackEdit("04_glass_slideshow_amber_zoom", {
    IMAGE_1: `${base}/overlays/transitions/preview-stills/a.png`,
    IMAGE_2: `${base}/overlays/transitions/preview-stills/b.png`,
    IMAGE_3: `${base}/overlays/transitions/preview-stills/c.png`,
  });
  const glassImgs = glass.timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => (c.asset as { type?: string } | undefined)?.type === "image");
  ok(
    "glass 9s = 3×3s centered 1550x870",
    glassImgs.length === 3 &&
      glassImgs.every(
        (c, i) =>
          Number(c.start) === i * 3 &&
          Number(c.length) === 3 &&
          Number(c.width) === 1550 &&
          Number(c.height) === 870
      )
  );

  const style = fs.readFileSync("client/src/components/StyleSelectorCard.tsx", "utf8");
  ok("Mystery v2 in UI", style.includes("Mystery v2"));

  const failed = checks.filter((c) => !c.pass);
  const overall = failed.length === 0 ? "ALL_GOOD" : failed.every((f) => f.name.includes("PEXELS") || f.name.includes("PIXABAY")) ? "WORKS_WITH_OPTIONAL_GAPS" : "ISSUES";
  console.log(JSON.stringify({ overall, failed: failed.map((f) => f.name), checks }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
