import { useRef, useState, DragEvent, ChangeEvent } from "react";

export function UploadDropzone({
  label,
  accept,
  multiple,
  note,
  onFiles,
  files,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  note?: string;
  onFiles: (files: FileList | null) => void;
  files?: File[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setActive(false);
    onFiles(e.dataTransfer.files);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    onFiles(e.target.files);
  }

  return (
    <div>
      <div
        className={`dropzone ${active ? "active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setActive(true);
        }}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
      >
        <div><strong>{label}</strong></div>
        <div style={{ marginTop: 6, fontSize: 12 }}>{note || "Drag & drop or click to upload"}</div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={onChange}
        />
      </div>
      {files && files.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {files.map((f) => (
            <span className="file-chip" key={f.name + f.size}>
              {f.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
