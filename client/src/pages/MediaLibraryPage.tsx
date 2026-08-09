import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/Badges";
import { api } from "../lib/api";
import { RoyalAssistantPanel } from "../components/RoyalAssistantPanel";

type RootLibrary = {
  updatedAt: string;
  niches: Array<{
    niche: string;
    nicheSlug: string;
    peopleCount: number;
    images: number;
    raw_footage: number;
  }>;
};

type NicheLibrary = {
  niche: string;
  nicheSlug: string;
  people: Array<{
    person: string;
    personSlug: string;
    images: number;
    raw_footage: number;
    group?: string;
  }>;
};

type LibraryAsset = {
  assetId: string;
  number: number;
  mediaType: "image" | "raw_footage";
  category: string;
  r2Key: string;
  thumbKey?: string;
  title?: string;
  description?: string;
  sourceUrl?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  width?: number;
  height?: number;
};

type PersonLibrary = {
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  counts: {
    images: number;
    raw_footage: number;
    byCategory: Record<string, number>;
  };
  assets: LibraryAsset[];
};

function assetUrl(r2Key: string): string {
  return `/api/media-library/asset?key=${encodeURIComponent(r2Key)}`;
}

function previewUrl(a: LibraryAsset): string | null {
  if (a.mediaType === "image") return assetUrl(a.r2Key);
  if (a.thumbKey) return assetUrl(a.thumbKey);
  return null;
}

function clipLabel(a: LibraryAsset): string {
  if (a.description?.trim()) return a.description.trim();
  if (a.title?.trim()) return a.title.trim();
  return `${a.category.replace(/_/g, " ")} clip`;
}

function splitDescription(text: string): { visual: string; useFor: string | null } {
  const m = text.match(/^(.*?)\s*Use for:\s*(.+)$/is);
  if (m) return { visual: m[1].trim(), useFor: m[2].trim() };
  return { visual: text.trim(), useFor: null };
}

export function MediaLibraryPage() {
  const [root, setRoot] = useState<RootLibrary | null>(null);
  const [niche, setNiche] = useState<NicheLibrary | null>(null);
  const [person, setPerson] = useState<PersonLibrary | null>(null);
  const [mediaType, setMediaType] = useState<"all" | "image" | "raw_footage">("image");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<RootLibrary>("/api/media-library")
      .then(setRoot)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openNiche = async (nicheSlug: string) => {
    setError("");
    setPerson(null);
    setLoading(true);
    try {
      const data = await api<NicheLibrary>(`/api/media-library/${nicheSlug}`);
      setNiche(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openPerson = async (nicheSlug: string, personSlug: string, mt = mediaType, cat = category) => {
    setError("");
    setLoading(true);
    try {
      const q = new URLSearchParams({ mediaType: mt, category: cat });
      const data = await api<PersonLibrary>(`/api/media-library/${nicheSlug}/${personSlug}?${q}`);
      setPerson(data);
      setSelectedId(data.assets[0]?.assetId || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const selected = useMemo(
    () => person?.assets.find((a) => a.assetId === selectedId) || null,
    [person, selectedId]
  );

  const categories = useMemo(() => {
    if (!person) return [];
    return Object.keys(person.counts.byCategory || {}).sort();
  }, [person]);

  return (
    <AppShell
      title="Media Library"
      breadcrumbs={
        person
          ? `${person.niche} / ${person.person}`
          : niche
            ? niche.niche
            : "R2 shared library"
      }
      actions={
        <div className="btn-row">
          {person && (
            <button className="btn btn-secondary" type="button" onClick={() => setPerson(null)}>
              ← Back
            </button>
          )}
          {niche && !person && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setNiche(null);
              }}
            >
              ← Niches
            </button>
          )}
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}

      {!loading && !niche && !person && (
        <div className="card-grid">
          {(root?.niches || []).map((n) => (
            <button
              key={n.nicheSlug}
              type="button"
              className="card card-pad"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => openNiche(n.nicheSlug)}
            >
              <h3 className="card-title">{n.niche}</h3>
              <p className="dim" style={{ marginTop: 8 }}>
                {n.peopleCount} people · {n.images} images · {n.raw_footage} raw clips
              </p>
            </button>
          ))}
          {!root?.niches?.length && (
            <div className="state-box">No niches yet. Collect images to populate the library.</div>
          )}
        </div>
      )}

      {!loading && niche && !person && (
        <div style={{ display: "grid", gap: 18 }}>
          {Object.entries(
            niche.people.reduce<Record<string, typeof niche.people>>((acc, p) => {
              const g = p.group || "People";
              (acc[g] ||= []).push(p);
              return acc;
            }, {})
          )
            .sort(([a], [b]) => {
              const order = (g: string) =>
                g === "People"
                  ? 0
                  : g.startsWith("Exact")
                    ? 1
                    : g.startsWith("General")
                      ? 2
                      : g.startsWith("Extra")
                        ? 3
                        : 9;
              return order(a) - order(b) || a.localeCompare(b);
            })
            .map(([group, people]) => (
              <div key={group}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, opacity: 0.85 }}>{group}</h3>
                <div className="card-grid">
                  {people.map((p) => (
                    <button
                      key={p.personSlug}
                      type="button"
                      className="card card-pad"
                      style={{ textAlign: "left", cursor: "pointer" }}
                      onClick={() => openPerson(niche.nicheSlug, p.personSlug)}
                    >
                      <h3 className="card-title">{p.person}</h3>
                      <p className="dim" style={{ marginTop: 8 }}>
                        {p.images} images · {p.raw_footage} raw clips
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {!loading && person && (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="btn-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <select
                value={mediaType}
                onChange={(e) => {
                  const v = e.target.value as typeof mediaType;
                  setMediaType(v);
                  openPerson(person.nicheSlug, person.personSlug, v, category);
                }}
              >
                <option value="all">All media</option>
                <option value="image">Images only</option>
                <option value="raw_footage">Raw footage only</option>
              </select>
              <select
                value={category}
                onChange={(e) => {
                  const v = e.target.value;
                  setCategory(v);
                  openPerson(person.nicheSlug, person.personSlug, mediaType, v);
                }}
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c} ({person.counts.byCategory[c] || 0})
                  </option>
                ))}
              </select>
              <span className="dim">
                Showing {person.assets.length} · indexed {person.counts.images} images /{" "}
                {person.counts.raw_footage} raw
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 0.7fr", gap: 14 }}>
            <div className="library-grid">
              {person.assets.map((a) => {
                const thumb = previewUrl(a);
                return (
                  <button
                    key={a.assetId}
                    type="button"
                    className={`library-card ${selectedId === a.assetId ? "active" : ""}`}
                    onClick={() => setSelectedId(a.assetId)}
                  >
                    <div className="library-thumb">
                      {thumb ? (
                        <img src={thumb} alt={clipLabel(a)} loading="lazy" />
                      ) : a.mediaType === "raw_footage" ? (
                        <video
                          src={assetUrl(a.r2Key)}
                          muted
                          playsInline
                          preload="metadata"
                          onMouseEnter={(e) => {
                            void e.currentTarget.play().catch(() => undefined);
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0;
                          }}
                        />
                      ) : (
                        <span className="dim">No preview</span>
                      )}
                      {a.mediaType === "raw_footage" && <span className="raw-badge">RAW</span>}
                    </div>
                    <div className="library-meta">
                      <strong>
                        #{a.number} · {a.category.replace(/_/g, " ")}
                      </strong>
                      {(() => {
                        const parts = splitDescription(clipLabel(a));
                        return (
                          <>
                            <div className="library-desc">{parts.visual}</div>
                            {parts.useFor && (
                              <div className="library-desc" style={{ marginTop: 4, opacity: 0.85 }}>
                                <strong>Use for:</strong> {parts.useFor}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </button>
                );
              })}
              {!person.assets.length && <div className="state-box">No assets for this filter.</div>}
            </div>

            <div className="card card-pad">
              {selected ? (
                <>
                  <h3 className="card-title">
                    #{selected.number} · {selected.category.replace(/_/g, " ")}
                  </h3>
                  {(() => {
                    const parts = splitDescription(clipLabel(selected));
                    return (
                      <>
                        <p className="dim" style={{ marginTop: 6, lineHeight: 1.45 }}>
                          {parts.visual}
                        </p>
                        {parts.useFor && (
                          <p
                            style={{
                              marginTop: 10,
                              lineHeight: 1.45,
                              padding: "10px 12px",
                              borderRadius: 8,
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <strong style={{ display: "block", marginBottom: 4, fontSize: 12, opacity: 0.75 }}>
                              USE FOR
                            </strong>
                            {parts.useFor}
                          </p>
                        )}
                      </>
                    );
                  })()}

                  {selected.mediaType === "image" ? (
                    <img
                      src={assetUrl(selected.r2Key)}
                      alt=""
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        marginTop: 10,
                        marginBottom: 12,
                        objectFit: "cover",
                        maxHeight: 280,
                      }}
                    />
                  ) : (
                    <video
                      key={selected.assetId}
                      className="library-player"
                      src={assetUrl(selected.r2Key)}
                      poster={selected.thumbKey ? assetUrl(selected.thumbKey) : undefined}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  )}

                  <div className="kv">
                    <div className="kv-row">
                      <span>Number</span>
                      <span>#{selected.number}</span>
                    </div>
                    <div className="kv-row">
                      <span>Category</span>
                      <span>{selected.category}</span>
                    </div>
                    <div className="kv-row">
                      <span>Type</span>
                      <span>{selected.mediaType}</span>
                    </div>
                    {(selected.startTime != null || selected.duration != null) && (
                      <div className="kv-row">
                        <span>Timing</span>
                        <span>
                          {selected.startTime != null ? `${selected.startTime.toFixed(1)}s` : "?"}
                          {selected.endTime != null ? `–${selected.endTime.toFixed(1)}s` : ""}
                          {selected.duration != null ? ` (${selected.duration.toFixed(1)}s)` : ""}
                        </span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span>Size</span>
                      <span>
                        {selected.width || "?"}×{selected.height || "?"}
                      </span>
                    </div>
                    {selected.sourceUrl && (
                      <div className="kv-row">
                        <span>Source</span>
                        <span className="mono" style={{ fontSize: 11 }}>
                          {selected.sourceUrl}
                        </span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span>Asset ID</span>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {selected.assetId}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="dim">Select an asset</p>
              )}
            </div>
          </div>
        </>
      )}
      <div style={{ marginTop: 16 }}>
        <RoyalAssistantPanel />
      </div>
    </AppShell>
  );
}
