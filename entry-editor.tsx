"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { TAGS } from "@/lib/constants";
import { TagBadge, type TableData } from "@/components/ui";
import type { Entry, SaveStatus } from "./types";

const ls = {
  get(k: string) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage full or blocked: server autosave still works */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
export const draftStorage = ls;

interface Draft {
  tag: string | null;
  body: string;
  table: TableData | null;
  ts: number;
}

async function prepareImage(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error("Please choose a PNG, JPEG or WebP picture.");
  const url: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("That picture could not be opened."));
    i.src = url;
  });
  const max = 1600;
  if (file.size < 1_500_000 && img.width <= max && img.height <= max) return url;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL("image/jpeg", 0.85);
  if (out.length * 0.75 > 2_900_000) throw new Error("That picture is too large. Try a smaller one.");
  return out;
}

interface Props {
  part: number;
  studentId: number;
  entry: Entry | null; // null = brand-new, not yet on the server
  draftKey: string;
  readOnly: boolean;
  onSaved: (e: Entry) => void;
  onDeleted: (key: string, id: number | null) => void;
  onStatus: (key: string, s: SaveStatus) => void;
  onEditing: (key: string, editing: boolean, entryId: number | null) => void;
}

export function EntryEditor({ part, studentId, entry, draftKey, readOnly, onSaved, onDeleted, onStatus, onEditing }: Props) {
  const storeKey = `si:${studentId}:p${part}:${draftKey}`;
  const initial = useRef<Draft | null>(ls.get(storeKey));
  const [tag, setTag] = useState<string | null>(initial.current ? initial.current.tag : entry?.tag ?? null);
  const [body, setBody] = useState<string>(initial.current ? initial.current.body : entry?.body ?? "");
  const [table, setTable] = useState<TableData | null>(initial.current ? initial.current.table : entry?.table ?? null);
  const [hasImage, setHasImage] = useState(entry?.hasImage ?? false);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>(initial.current ? "unsaved" : "idle");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [focused, setFocused] = useState(false);

  const id = useRef<number | null>(entry?.id ?? null);
  const baseUpdated = useRef<number>(entry?.updatedAt ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const again = useRef(false);
  const pendingImage = useRef<string | null | undefined>(undefined); // undefined=no change, null=remove
  const latest = useRef({ tag, body, table });
  latest.current = { tag, body, table };
  const dirty = useRef(!!initial.current);

  const setSt = useCallback(
    (s: SaveStatus) => {
      setStatus(s);
      onStatus(draftKey, s);
    },
    [onStatus, draftKey]
  );

  // If the same entry changes elsewhere (another device) and we have nothing unsaved, follow it.
  useEffect(() => {
    if (entry && !dirty.current && !saving.current && entry.updatedAt > baseUpdated.current) {
      baseUpdated.current = entry.updatedAt;
      setTag(entry.tag);
      setBody(entry.body);
      setTable(entry.table);
      setHasImage(entry.hasImage);
    }
  }, [entry]);

  const save = useCallback(async () => {
    if (readOnly) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    const cur = latest.current;
    const empty = !cur.body.trim() && !cur.tag && !cur.table && pendingImage.current === undefined && !hasImage;
    if (id.current === null && empty) {
      dirty.current = false;
      ls.del(storeKey);
      setSt("idle");
      return;
    }
    saving.current = true;
    setSt("saving");
    setErr("");
    const sentImage = pendingImage.current;
    try {
      let res: { entry: Entry };
      if (id.current === null) {
        res = await api("POST", "/student/entries", { part, tag: cur.tag, body: cur.body, table: cur.table, image: sentImage || undefined });
        id.current = res.entry.id;
      } else {
        const payload: Record<string, unknown> = { tag: cur.tag, body: cur.body, table: cur.table, baseUpdatedAt: baseUpdated.current };
        if (sentImage !== undefined) payload.image = sentImage;
        res = await api("PATCH", `/student/entries/${id.current}`, payload);
      }
      baseUpdated.current = res.entry.updatedAt;
      if (pendingImage.current === sentImage) {
        pendingImage.current = undefined;
        setPreview(null);
      }
      setHasImage(res.entry.hasImage);
      onSaved(res.entry);
      const changedMeanwhile = again.current || latest.current.body !== cur.body || latest.current.tag !== cur.tag || latest.current.table !== cur.table;
      if (!changedMeanwhile) {
        dirty.current = false;
        ls.del(storeKey);
        setSt("saved");
      } else {
        again.current = false;
        saving.current = false;
        setTimeout(save, 50);
        return;
      }
    } catch (e) {
      const a = e as ApiError;
      if (a.code === "stale") {
        setErr("This entry was changed on another device.");
        setSt("error");
      } else if (a.status >= 400 && a.status < 500 && a.status !== 0 && a.status !== 429) {
        setErr(a.message);
        setSt("error");
        dirty.current = true;
      } else {
        setErr(a.message || "Could not save. Retrying…");
        setSt("error");
      }
    } finally {
      saving.current = false;
    }
  }, [readOnly, part, hasImage, onSaved, setSt, storeKey]);

  const schedule = useCallback(
    (delay = 900) => {
      dirty.current = true;
      ls.set(storeKey, { ...latest.current, ts: Date.now() } satisfies Draft);
      setSt("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, delay);
    },
    [save, setSt, storeKey]
  );

  // Restored local draft (after refresh / crash): save it right away.
  useEffect(() => {
    if (initial.current) timer.current = setTimeout(save, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Automatic retry while in error state (network down etc.)
  useEffect(() => {
    if (status !== "error" || err.includes("another device")) return;
    const t = setTimeout(save, 8000);
    return () => clearTimeout(t);
  }, [status, err, save]);

  // Tell the group (presence) while this entry has unsaved work or the cursor is in it.
  const editing = !readOnly && (focused || status === "unsaved" || status === "saving" || status === "error");
  useEffect(() => {
    onEditing(draftKey, editing, id.current ?? 0);
  }, [editing, draftKey, onEditing, status]);
  useEffect(() => () => onEditing(draftKey, false, null), [draftKey, onEditing]);

  async function pickImage(f: File | undefined) {
    if (!f) return;
    setErr("");
    try {
      const url = await prepareImage(f);
      pendingImage.current = url;
      setPreview(url);
      setHasImage(true);
      schedule(100);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove() {
    if (id.current !== null) {
      try {
        await api("DELETE", `/student/entries/${id.current}`);
      } catch (e) {
        setErr((e as ApiError).message);
        return;
      }
    }
    ls.del(storeKey);
    onStatus(draftKey, "idle");
    onEditing(draftKey, false, null);
    onDeleted(draftKey, id.current);
  }

  const updateCell = (r: number, c: number, v: string) => {
    if (!table) return;
    const rows = table.rows.map((row) => row.slice());
    rows[r][c] = v;
    setTable({ ...table, rows });
    latest.current.table = { ...table, rows };
    schedule();
  };
  const updateHead = (c: number, v: string) => {
    if (!table) return;
    const cols = table.columns.slice();
    cols[c] = v;
    const t = { ...table, columns: cols };
    setTable(t);
    latest.current.table = t;
    schedule();
  };
  const mutTable = (t: TableData | null) => {
    setTable(t);
    latest.current.table = t;
    schedule();
  };

  const badge = {
    idle: null,
    saved: <span className="badge bg-emerald-100 text-emerald-800">✓ Saved</span>,
    saving: <span className="badge bg-blue-100 text-blue-800">Saving…</span>,
    unsaved: <span className="badge bg-amber-100 text-amber-800">Unsaved changes</span>,
    error: <span className="badge bg-rose-100 text-rose-800">Not saved – retrying</span>,
  }[status];

  return (
    <div className="rounded-2xl border-2 border-blue-200 bg-white p-4 shadow-sm" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-800">
          <span className="rounded-full bg-blue-700 px-2 py-0.5 text-white">My entry</span>
          {readOnly && <span className="text-slate-500">(locked)</span>}
        </div>
        <div aria-live="polite">{badge}</div>
      </div>

      {readOnly ? (
        <div className="mb-2">
          <TagBadge tag={tag} />
        </div>
      ) : (
        <div className="mb-3">
          <label className="label" htmlFor={`tag-${draftKey}`}>
            Entry tag
          </label>
          <select id={`tag-${draftKey}`} className="input max-w-xs" value={tag ?? ""} onChange={(e) => { const v = e.target.value || null; setTag(v); latest.current.tag = v; schedule(300); }}>
            <option value="">No tag</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      <textarea className="input min-h-[110px] resize-y" placeholder="Write your idea, plan or observation…" value={body} readOnly={readOnly} maxLength={4000} aria-label="Entry text" onChange={(e) => { setBody(e.target.value); latest.current.body = e.target.value; schedule(); }} />

      {hasImage && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview || `/api/images/${id.current}`} alt="Attached evidence" className="max-h-56 rounded-lg border border-slate-200 object-contain" />
          {!readOnly && (
            <button className="btn-ghost btn-sm mt-2" onClick={() => { pendingImage.current = null; setPreview(null); setHasImage(false); schedule(100); }}>
              Remove picture
            </button>
          )}
        </div>
      )}

      {table && (
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {table.columns.map((c, ci) => (
                  <th key={ci} className="border border-slate-300 bg-slate-100 p-0">
                    <input className="w-28 bg-transparent px-2 py-1.5 font-semibold outline-none" value={c} readOnly={readOnly} maxLength={80} aria-label={`Column ${ci + 1} name`} onChange={(e) => updateHead(ci, e.target.value)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-slate-300 p-0">
                      <input className="w-28 bg-transparent px-2 py-1.5 outline-none" value={c} readOnly={readOnly} maxLength={80} aria-label={`Row ${ri + 1}, ${table.columns[ci] || `column ${ci + 1}`}`} onChange={(e) => updateCell(ri, ci, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-ghost btn-sm" disabled={table.rows.length >= 30} onClick={() => mutTable({ ...table, rows: [...table.rows, table.columns.map(() => "")] })}>
                + Row
              </button>
              <button className="btn-ghost btn-sm" disabled={table.columns.length >= 8} onClick={() => mutTable({ columns: [...table.columns, `Column ${table.columns.length + 1}`], rows: table.rows.map((r) => [...r, ""]) })}>
                + Column
              </button>
              <button className="btn-ghost btn-sm" disabled={table.rows.length <= 1} onClick={() => mutTable({ ...table, rows: table.rows.slice(0, -1) })}>
                − Row
              </button>
              <button className="btn-ghost btn-sm" disabled={table.columns.length <= 1} onClick={() => mutTable({ columns: table.columns.slice(0, -1), rows: table.rows.map((r) => r.slice(0, -1)) })}>
                − Column
              </button>
              <button className="btn-ghost btn-sm" onClick={() => mutTable(null)}>
                Remove table
              </button>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          {err}
          {err.includes("another device") && id.current !== null && (
            <div className="mt-2 flex gap-2">
              <button className="btn-primary btn-sm" onClick={async () => { baseUpdated.current = Number.MAX_SAFE_INTEGER; setErr(""); saving.current = false; try { const r = await api<{ entry: Entry }>("PATCH", `/student/entries/${id.current}`, { ...latest.current, force: true }); baseUpdated.current = r.entry.updatedAt; onSaved(r.entry); dirty.current = false; ls.del(storeKey); setSt("saved"); } catch (e) { setErr((e as ApiError).message); } }}>
                Keep what I typed
              </button>
              <button className="btn-ghost btn-sm" onClick={() => { ls.del(storeKey); dirty.current = false; baseUpdated.current = 0; setErr(""); setSt("idle"); }}>
                Use the other version
              </button>
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="btn-ghost btn-sm cursor-pointer">
            📷 {hasImage ? "Replace picture" : "Add picture"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {!table && (
            <button className="btn-ghost btn-sm" onClick={() => mutTable({ columns: ["Trial", "Result"], rows: [["", ""], ["", ""], ["", ""]] })}>
              ▦ Add data table
            </button>
          )}
          <span className="flex-1" />
          {confirmDel ? (
            <span className="flex items-center gap-2 text-xs">
              Delete this entry?
              <button className="btn-danger btn-sm" onClick={remove}>
                Yes, delete
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button className="btn-ghost btn-sm text-rose-700" onClick={() => (id.current === null && !body && !table && !hasImage ? remove() : setConfirmDel(true))}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
