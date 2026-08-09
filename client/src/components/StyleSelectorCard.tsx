const STYLES = [
  {
    id: "Celebrity v1",
    title: "Celebrity v1",
    description: "Exact person identity, era, and relationships. No random stock people.",
  },
  {
    id: "Space v1",
    title: "Space v1",
    description: "Dark cinematic space visuals — spacecraft, telescopes, mission control.",
  },
  {
    id: "Mystery v1",
    title: "Mystery v1",
    description:
      "Clean documentary evidence visuals — places, artifacts, maps, documents. Soft filter rejects watermarks & baked-in text only.",
  },
  {
    id: "Mystery v2",
    title: "Mystery v2",
    description:
      "Mystery documentary on RunPod Remotion — narration-locked stills, glass/reveal/FX + film-burn overlays, 7s intro. Images-only final render.",
  },
  {
    id: "War v1",
    title: "War v1",
    description:
      "Conflict documentary visuals — battles, fronts, archives, maps, equipment. No lifestyle stock.",
  },
  {
    id: "Royal v1",
    title: "Royal v1",
    description: "Correct royal person, family, event, and place — no identity mixups.",
  },
  {
    id: "Royal v2",
    title: "Royal v2",
    description:
      "R2 library-first bulk assembly with exact people and places, strict repetition control, manager review, and timeline locking.",
  },
] as const;

export function StyleSelectorCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="style-grid">
      {STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`style-card ${value === s.id ? "selected" : ""}`}
          onClick={() => onChange(s.id)}
        >
          <h4>{s.title}</h4>
          <p>{s.description}</p>
        </button>
      ))}
    </div>
  );
}
