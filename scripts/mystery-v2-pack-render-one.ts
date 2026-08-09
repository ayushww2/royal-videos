import dotenv from "dotenv";
dotenv.config();
import { renderMysteryPackPreset } from "../server/visualIntelligence/mysteryV2/packRender.js";

const presetId = (process.argv[2] || "01_lower_third_blue_clean") as
  | "01_lower_third_blue_clean"
  | "02_question_ask_mystery"
  | "03_reveal_mystery"
  | "04_glass_slideshow_amber_zoom"
  | "05_glass_slideshow_crimson_carousel"
  | "06_glass_slideshow_midnight_wipe"
  | "07_glass_slideshow_violet_reveal"
  | "08_side_by_side_black_white_border"
  | "09_red_grid_white_lines_75_percent";

renderMysteryPackPreset({ presetId, poll: true })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    if (r.status !== "done") process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
