import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/Badges";
import { api } from "../lib/api";
import { ROYAL_MEDIA_NICHE_SLUG } from "../lib/royal";
import { RoyalAssistantPanel } from "../components/RoyalAssistantPanel";

type RootLibrary = {
  updatedAt: string;
  niches: Array<{
    niche: string;
    nicheSlug: string;
    peopleCount: number;
    images: number;
    raw_footage: number;
    trusted_clips?: number;
    raw_clips?: number;
  }>;
};

type NichePerson = {
  person: string;
  personSlug: string;
  images: number;
  raw_footage: number;
  trusted_clips?: number;
  raw_clips?: number;
  group?: string;
};

type NicheLibrary = {
  niche: string;
  nicheSlug: string;
  people: NichePerson[];
};

type LibraryAsset = {
  assetId: string;
  number: number;
  mediaType: "image" | "raw_footage" | "trusted_clip";
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
    trusted_clips?: number;
    raw_clips?: number;
    byCategory: Record<string, number>;
  };
  assets: LibraryAsset[];
};

type MediaFilter = "all" | "image" | "raw_clips";

const PEOPLE_ORDER = [
  "king-charles",
  "queen-camilla",
  "prince-william",
  "princess-catherine",
  "prince-george",
  "princess-charlotte",
  "prince-louis",
  "prince-harry",
  "meghan-markle",
  "princess-diana",
  "princess-anne",
  "sir-timothy-laurence",
  "prince-edward",
  "sophie-duchess-of-edinburgh",
  "prince-andrew",
  "sarah-ferguson",
  "princess-beatrice",
  "princess-eugenie",
  "zara-tindall",
  "laura-lopes",
  "tom-parker-bowles",
];

const PLACE_SLUGS = new Set([
  "topic-balmoral-castle",
  "topic-buckingham-palace",
  "topic-clarence-house",
  "topic-highgrove-house",
  "topic-kensington-palace",
  "topic-palace-exterior",
  "topic-parliament-downing-street",
  "topic-royal-courts-of-justice",
  "topic-sandringham",
  "topic-st-george-s-chapel",
  "topic-westminster-abbey",
  "topic-windsor-castle",
]);

const CONTEXT_SLUGS = new Set([
  "topic-black-cars-arriving",
  "topic-church-exterior",
  "topic-court-building",
  "topic-london-street",
  "topic-london-streets-media-areas",
  "topic-press-outside-building",
  "topic-royal-gates",
  "topic-security-barriers",
]);

function rawClipsCount(p: {
  raw_footage?: number;
  trusted_clips?: number;
  raw_clips?: number;
}): number {
  if (typeof p.raw_clips === "number") return p.raw_clips;
  return Number(p.raw_footage || 0) + Number(p.trusted_clips || 0);
}

function assetUrl(r2Key: string): string {
  return `/api/media-library/asset?key=${encodeURIComponent(r2Key)}`;
}

function isRawClip(a: LibraryAsset): boolean {
  return a.mediaType === "raw_footage" || a.mediaType === "trusted_clip";
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

function sectionForPerson(p: NichePerson): "People" | "Places" | "Context" {
  const g = String(p.group || "").toLowerCase();
  if (g === "places" || g === "place") return "Places";
  if (g === "context" || g === "b-roll" || g === "broll") return "Context";
  if (g === "people" || g === "person") return "People";
  if (PLACE_SLUGS.has(p.personSlug)) return "Places";
  if (CONTEXT_SLUGS.has(p.personSlug)) return "Context";
  if (p.personSlug.startsWith("topic-") && !p.personSlug.startsWith("topic-extra-")) {
    return /palace|castle|house|chapel|abbey|street|court|building|gates|sandringham|balmoral|windsor|westminster|kensington|clarence|highgrove|parliament/i.test(
      p.personSlug
    )
      ? "Places"
      : "Context";
  }
  return "People";
}

function groupPeople(people: NichePerson[]): Array<{ section: string; people: NichePerson[] }> {
  const buckets: Record<string, NichePerson[]> = { People: [], Places: [], Context: [] };
  for (const p of people) buckets[sectionForPerson(p)].push(p);
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => {
      if (key === "People") {
        const ai = PEOPLE_ORDER.indexOf(a.personSlug);
        const bi = PEOPLE_ORDER.indexOf(b.personSlug);
        const ao = ai >= 0 ? ai : 500;
        const bo = bi >= 0 ? bi : 500;
        if (ao !== bo) return ao - bo;
      }
      return a.person.localeCompare(b.person);
    });
  }
  return ["People", "Places", "Context"]
    .map((section) => ({ section, people: buckets[section] }))
    .filter((s) => s.people.length > 0);
}

export function MediaLibraryPage() {
  const [root, setRoot] = useState<RootLibrary | null>(null);
  const [niche, setNiche] = useState<NicheLibrary | null>(null);
  const [person, setPerson] = useState<PersonLibrary | null>(null);
  const [mediaType, setMediaType] = useState<MediaFilter>("image");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRawIds, setSelectedRawIds] = useState<string[]>([]);
  const [selectingRaw, setSelectingRaw] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const openNiche = async (nicheSlug: string) => {
    setError("");
    setPerson(null);
    setSelectedRawIds([]);
    setSelectingRaw(false);
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

  useEffect(() => {
    api<RootLibrary>("/api/media-library")
      .then((data) => {
        setRoot(data);
        const royal =
          data.niches?.find((n) => n.nicheSlug === ROYAL_MEDIA_NICHE_SLUG) ||
          data.niches?.find((n) => /royal/i.test(n.niche) || /royal/i.test(n.nicheSlug));
        if (royal) {
          return openNiche(royal.nicheSlug);
        }
        setError("Royal Family media niche not found.");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const openPerson = async (
    nicheSlug: string,
    personSlug: string,
    mt: MediaFilter = mediaType,
    cat = category
  ) => {
    setError("");
    setLoading(true);
    try {
      const q = new URLSearchParams({ mediaType: mt, category: cat });
      const data = await api<PersonLibrary>(`/api/media-library/${nicheSlug}/${personSlug}?${q}`);
      setPerson(data);
      setSelectedId(data.assets[0]?.assetId || null);
      setSelectedRawIds([]);
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

  const rawAssets = useMemo(() => (person?.assets || []).filter(isRawClip), [person]);

  const toggleRawSelected = (assetId: string) => {
    setSelectedRawIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  const deleteSelectedRaw = async () => {
    if (!person || !selectedRawIds.length) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(
        `/api/media-library/${person.nicheSlug}/${person.personSlug}/raw/bulk-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ assetIds: selectedRawIds }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setNotice(`Deleted ${data.deleted || selectedRawIds.length} raw clip(s)`);
      setSelectingRaw(false);
      setSelectedRawIds([]);
      await openPerson(person.nicheSlug, person.personSlug, "raw_clips", "all");
      setMediaType("raw_clips");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell
      title="Royal Media"
      breadcrumbs={
        person
          ? `Royal Media / ${person.person}`
          : niche
            ? `Royal Media / ${niche.niche}`
            : "Royal Media"
      }
      actions={
        <div className="btn-row">
          {person && (
            <button className="btn btn-secondary" type="button" onClick={() => setPerson(null)}>
              ← Back
            </button>
          )}
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}

      {!loading && !niche && !person && (
        <div className="state-box">
          {root?.niches?.length
            ? "Royal Family media niche not found."
            : "No royal media yet. Collect images to populate the library."}
        </div>
      )}

      {!loading && niche && !person && (
        <div className="royal-roster">
          <header className="royal-roster-intro">
            <p className="eyebrow">Royal Family library</p>
            <h2>People, places &amp; context</h2>
            <p className="lede">
              Browse stills and raw clips organized by subject — open anyone to review or manage media.
            </p>
          </header>

          {groupPeople(niche.people).map(({ section, people }) => (
            <section key={section} className="royal-roster-section">
              <div className="royal-roster-section-head">
                <h3>{section}</h3>
                <span>{people.length}</span>
              </div>
              <div className="royal-roster-grid">
                {people.map((p) => (
                  <button
                    key={p.personSlug}
                    type="button"
                    className="royal-person-tile"
                    onClick={() => openPerson(niche.nicheSlug, p.personSlug)}
                  >
                    <span className="royal-person-name">{p.person}</span>
                    <span className="royal-person-meta">
                      {p.images} images · {rawClipsCount(p)} raw clips
                    </span>
                  </button>
                ))}
              </div>
            </section>
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
                  const v = e.target.value as MediaFilter;
                  setMediaType(v);
                  openPerson(person.nicheSlug, person.personSlug, v, category);
                }}
              >
                <option value="all">All media</option>
                <option value="image">Images only</option>
                <option value="raw_clips">Raw clips only</option>
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
                {rawClipsCount(person.counts)} raw clips
              </span>
              <button
                type="button"
                className={`btn btn-sm ${selectingRaw ? "btn-primary" : "btn-secondary"}`}
                onClick={() => {
                  const next = !selectingRaw;
                  setSelectingRaw(next);
                  if (!next) setSelectedRawIds([]);
                  if (next && mediaType !== "raw_clips") {
                    setMediaType("raw_clips");
                    openPerson(person.nicheSlug, person.personSlug, "raw_clips", category);
                  }
                }}
              >
                {selectingRaw ? "Selecting raw…" : "Select raw clips"}
              </button>
              {selectingRaw && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!rawAssets.length}
                    onClick={() => setSelectedRawIds(rawAssets.map((a) => a.assetId))}
                  >
                    Select all ({rawAssets.length})
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!selectedRawIds.length}
                    onClick={() => setSelectedRawIds([])}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={!selectedRawIds.length || deleting}
                    onClick={() => void deleteSelectedRaw()}
                  >
                    {deleting ? "Deleting…" : `Delete selected (${selectedRawIds.length})`}
                  </button>
                </>
              )}
              <label
                className="btn btn-secondary btn-sm"
                style={{ cursor: uploading ? "wait" : "pointer" }}
              >
                {uploading ? "Uploading…" : "Upload raw clips"}
                <input
                  type="file"
                  accept=".zip,video/mp4,video/quicktime,video/webm"
                  multiple
                  hidden
                  disabled={uploading}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    if (!files.length || !person) return;
                    setUploading(true);
                    setNotice("");
                    setError("");
                    try {
                      const body = new FormData();
                      body.set("person", person.person);
                      for (const f of files) body.append("files", f);
                      const res = await fetch(
                        `/api/media-library/${person.nicheSlug}/${person.personSlug}/trusted`,
                        { method: "POST", body, credentials: "include" }
                      );
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Upload failed");
                      const added = (data.results || []).reduce(
                        (n: number, r: { added?: number }) => n + (r.added || 0),
                        0
                      );
                      setNotice(`Added ${added} raw clip(s)`);
                      setMediaType("raw_clips");
                      await openPerson(person.nicheSlug, person.personSlug, "raw_clips", "all");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
            </div>
            {notice && (
              <p className="help" style={{ marginTop: 8 }}>
                {notice}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 0.7fr", gap: 14 }}>
            <div className="library-grid">
              {person.assets.map((a) => {
                const thumb = previewUrl(a);
                const checked = selectedRawIds.includes(a.assetId);
                const selectable = selectingRaw && isRawClip(a);
                return (
                  <button
                    key={a.assetId}
                    type="button"
                    className={`library-card ${selectedId === a.assetId ? "active" : ""} ${
                      checked ? "checked" : ""
                    }`}
                    onClick={() => {
                      if (selectable) toggleRawSelected(a.assetId);
                      else setSelectedId(a.assetId);
                    }}
                  >
                    <div className="library-thumb" style={{ position: "relative" }}>
                      {thumb ? (
                        <img src={thumb} alt={clipLabel(a)} loading="lazy" />
                      ) : isRawClip(a) ? (
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
                      {isRawClip(a) && <span className="raw-badge">RAW</span>}
                      {selectable && (
                        <span className={`raw-check ${checked ? "on" : ""}`}>
                          {checked ? "✓" : ""}
                        </span>
                      )}
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
                            <strong
                              style={{
                                display: "block",
                                marginBottom: 4,
                                fontSize: 12,
                                opacity: 0.75,
                              }}
                            >
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
                      <span>{isRawClip(selected) ? "raw clip" : selected.mediaType}</span>
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
