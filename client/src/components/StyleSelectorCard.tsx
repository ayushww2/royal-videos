const STYLES = [
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
