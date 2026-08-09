export function nicheRules(niche: string): string {
  switch (niche) {
    case "Celebrity v1":
      return [
        "Correct person identity is most important.",
        "Correct couple/family if mentioned.",
        "Correct age/era/event/interview when specified.",
        "No random stock people.",
        "No wrong same-name celebrity.",
        "No offensive gestures / middle-finger / NSFW shock bait.",
        "Reference edit pacing (~5s holds, ~11 cuts/min): prefer archival interview/raw over flicker stills.",
        "Opener must show the correct subject face when available.",
      ].join(" ");
    case "Space v1":
      return [
        "Prefer dark cinematic space visuals.",
        "Prefer 30-50% clips if available.",
        "Spacecraft, telescopes, planets, mission control, observatories.",
        "No random city/office/lifestyle footage.",
      ].join(" ");
    case "Mystery v1":
      return [
        "Serious clean documentary evidence style.",
        "Prefer real places, artifacts, maps, documents, archaeology, investigation photos.",
        "Match narration subject: cave→cave, stone door→doorway/archaeology, researchers→field/lab, map→map, document→document.",
        "Reject mainly for visible watermark or big altered/baked-in text overlays.",
        "Do not reject clean dramatic web images just for being dramatic or from news/blogs.",
        "No cheap horror stock, meme graphics, or YouTube thumbnail text overlays.",
      ].join(" ");
    case "War v1":
      return [
        "Serious war and conflict documentary style.",
        "Prefer archival combat footage, fronts, trenches, battlefields, military equipment, maps, and period uniforms.",
        "Match narration: named battle→that battle, front→front line, aircraft→correct era aircraft, city→wartime cityscape.",
        "Prefer historical archive / newsreel / museum / battlefield photography look.",
        "No lifestyle stock, fashion, office, or random civilian travel footage.",
        "No video-game screenshots, toy soldiers, meme graphics, or YouTube thumbnail text overlays.",
      ].join(" ");
    case "Royal v1":
      return [
        "Correct royal person is required.",
        "Correct relationship/family/event/place.",
        "No Meghan/Kate/Camilla/Diana confusion.",
      ].join(" ");
    case "Royal v2":
      return [
        "The internal approved Royal Media Library was searched first; this is a weak-scene external fallback only.",
        "Correct royal person, pair/group, and exact named place are mandatory.",
        "Do not substitute one palace for another or confuse Catherine, Meghan, Camilla, Diana, or Anne.",
        "Reject generic context when the narration explicitly requires a named person or place.",
      ].join(" ");
    default:
      return "Prefer exact entity match over aesthetic stock.";
  }
}
