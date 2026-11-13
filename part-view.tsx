"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, usePoll, fmtTime, ApiError } from "@/lib/client/api";
import { EntryBody, TagBadge, Modal, Spinner, ErrorBox, Empty, useToast, type TableData } from "@/components/ui";
import { EntryEditor, draftStorage } from "./entry-editor";
import type { Entry, PartInfo, SaveStatus, Submission } from "./types";

interface EntriesResp {
  entries: Entry[];
  editing: { studentId: number; name: string; entryId: number }[];
  submission: Submission;
}

function GuidingQuestions({ qs }: { qs: { id: number; text: string }[] }) {
  if (!qs.length) return null;
  return (
    <div className="mt-4 rounded-xl bg-violet-50 p-4">
      <h4 className="mb-2 text-sm font-bold text-violet-900">Guiding questions</h4>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-violet-950">
        {qs.map((q) => (
          <li key={q.id}>{q.text}</li>
        ))}
      </ol>
    </div>
  );
}

export function PartView({ info, studentId, active, onChanged }: { info: PartInfo; studentId: number; active: boolean; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, loading, refresh, setData } = usePoll<EntriesResp>(info.locked ? null : `/student/entries?part=${info.part}`, active ? 4000 : 0);
  const [drafts, setDrafts] = useState<{ key: string; entry: Entry | null }[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const [editingMap, setEditingMap] = useState<Record<string, number>>({});
  const [showSubmit, setShowSubmit] = useState(false);
  const restored = useRef(false);

  const sub = data?.submission ?? info.submission ?? { status: "draft", revision: 0, submittedAt: null };
  const readOnly = sub.status === "submitted";

  // Restore any new entries that were typed but never reached the server (refresh / crash).
  useEffect(() => {
    if (restored.current || info.locked) return;
    restored.current = true;
    const prefix = `si:${studentId}:p${info.part}:new-`;
    const found: { key: string; entry: null }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) found.push({ key: k.slice(prefix.length - 4), entry: null });
      }
    } catch {
      /* ignore */
    }
    if (found.length) setDrafts((d) => [...found, ...d]);
  }, [info.locked, info.part, studentId]);

  const onStatus = useCallback((key: string, s: SaveStatus) => setStatuses((m) => (m[key] === s ? m : { ...m, [key]: s })), []);
  const onEditing = useCallback((key: string, editing: boolean, entryId: number | null) => {
    setEditingMap((m) => {
      if (editing) return m[key] === (entryId ?? 0) ? m : { ...m, [key]: entryId ?? 0 };
      if (!(key in m)) return m;
      const n = { ...m };
      delete n[key];
      return n;
    });
  }, []);
  const onSaved = useCallback(
    (e: Entry) => {
      setData((cur) => {
        if (!cur) return cur;
        const mine = { ...e, mine: true };
        const exists = cur.entries.some((x) => x.id === e.id);
        return { ...cur, entries: exists ? cur.entries.map((x) => (x.id === e.id ? mine : x)) : [...cur.entries, mine] };
      });
    },
    [setData]
  );
  const onDeleted = useCallback(
    (key: string, id: number | null) => {
      setDrafts((ds) => ds.filter((d) => d.key !== key));
      if (id !== null) setData((cur) => (cur ? { ...cur, entries: cur.entries.filter((x) => x.id !== id) } : cur));
      refresh();
    },
    [setData, refresh]
  );

  // Presence heartbeat: lets teammates (and the submit check) know someone has unsaved work.
  const editingIds = Object.values(editingMap);
  const isEditing = editingIds.length > 0;
  const firstEditing = isEditing ? editingIds[0] : null;
  useEffect(() => {
    if (info.locked) return;
    const send = () => api("POST", "/student/presence", { part: info.part, editingEntryId: firstEditing }).catch(() => {});
    send();
    if (!isEditing) return;
    const t = setInterval(send, 5000);
    return () => clearInterval(t);
  }, [isEditing, firstEditing, info.part, info.locked]);

  const unsaved = Object.values(statuses).some((s) => s === "unsaved" || s === "saving" || s === "error");
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsaved]);

  const draftEntryIds = new Set(drafts.map((d) => d.entry?.id).filter((x): x is number => !!x));
  const mineFromServer = (data?.entries ?? []).filter((e) => e.mine && !draftEntryIds.has(e.id));
  const others = (data?.entries ?? []).filter((e) => !e.mine);
  const editingNames = useMemo(() => (data?.editing ?? []).map((e) => e.name), [data]);

  if (info.locked)
    return (
      <div className="card flex flex-col items-center gap-3 py-16 text-center">
        <span className="text-4xl" aria-hidden>
          🔒
        </span>
        <h3 className="text-lg font-bold">{info.title}</h3>
        <p className="max-w-md text-sm text-slate-600">This part is locked. Your teacher will unlock it when the class is ready. This page checks automatically.</p>
      </div>
    );

  const newKey = () => `new-${Math.random().toString(36).slice(2, 10)}`;
  const entryCount = (data?.entries.length ?? 0) + drafts.filter((d) => d.entry === null).length;

  return (
    <div className="space-y-5">
      <div className="card">
        <h3 className="text-lg font-bold">{info.title}</h3>
        {info.instructions ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">{info.instructions}</p> : <p className="mt-2 text-sm italic text-slate-400">No instructions yet.</p>}
        {info.webLink && (
          <a href={info.webLink} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm mt-3">
            🔗 Open the web resource <span className="font-normal text-slate-400">(new tab)</span>
          </a>
        )}
        <GuidingQuestions qs={info.questions ?? []} />
      </div>

      {sub.status === "submitted" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
          <b>Submitted</b> by your group{sub.submittedAt ? ` on ${fmtTime(sub.submittedAt)}` : ""}
          {sub.revision > 1 ? ` (revision ${sub.revision})` : ""}. Entries are locked. If you need to change something, ask your teacher to unlock it.
        </div>
      )}
      {sub.status === "revising" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Your teacher has <b>reopened this part for revisions</b>. Make your changes, then submit again. Your earlier submission (revision {sub.revision}) is kept.
        </div>
      )}

      {error && !data && <ErrorBox message={error.message} onRetry={refresh} />}
      {error && data && <div className="rounded-lg bg-amber-50 p-2 text-center text-xs text-amber-800">Connection problem – showing the last update. Your own typing is still being kept safe.</div>}
      {loading && !data && <Spinner label="Loading your group’s entries…" />}

      {data && (
        <>
          {editingNames.length > 0 && (
            <p className="text-xs font-medium text-violet-700" aria-live="polite">
              ✎ {editingNames.join(", ")} {editingNames.length === 1 ? "is" : "are"} writing…
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {[...drafts.map((d) => ({ kind: "draft" as const, d })), ...mineFromServer.map((e) => ({ kind: "mine" as const, e }))].map((x) =>
              x.kind === "draft" ? (
                <EntryEditor key={x.d.key} part={info.part} studentId={studentId} entry={x.d.entry} draftKey={x.d.key} readOnly={readOnly} onSaved={(e) => { setDrafts((ds) => ds.map((d) => (d.key === x.d.key ? { ...d, entry: e } : d))); onSaved(e); }} onDeleted={onDeleted} onStatus={onStatus} onEditing={onEditing} />
              ) : (
                <EntryEditor key={`e-${x.e.id}`} part={info.part} studentId={studentId} entry={x.e} draftKey={`e${x.e.id}`} readOnly={readOnly} onSaved={onSaved} onDeleted={onDeleted} onStatus={onStatus} onEditing={onEditing} />
              )
            )}
            {others.map((e) => (
              <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">
                    <b className="text-slate-900">{e.author.name}</b> · {e.author.class} · No. {e.author.classNo}
                  </div>
                  <TagBadge tag={e.tag} />
                </div>
                <EntryBody body={e.body} hasImage={e.hasImage} entryId={e.id} table={e.table as TableData | null} />
              </div>
            ))}
          </div>

          {!readOnly && (
            <button className="btn-primary" onClick={() => setDrafts((d) => [{ key: newKey(), entry: null }, ...d])}>
              + Add my entry
            </button>
          )}
          {entryCount === 0 && <Empty>No entries yet. Add your first one, and your group will see it appear.</Empty>}
        </>
      )}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="text-sm">
          {unsaved ? <span className="font-semibold text-amber-700">Saving your latest changes…</span> : <span className="text-slate-600">All your changes are saved.</span>}
        </div>
        {readOnly ? (
          <span className="badge bg-emerald-100 px-3 py-1 text-sm text-emerald-800">✓ Submitted</span>
        ) : (
          <button className="btn-accent" disabled={unsaved || !data || entryCount === 0} onClick={() => setShowSubmit(true)}>
            Submit as a group…
          </button>
        )}
      </div>

      {showSubmit && (
        <SubmitDialog
          part={info.part}
          onClose={() => setShowSubmit(false)}
          onDone={() => {
            setShowSubmit(false);
            toast("Part submitted for your group");
            refresh();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

interface CheckResp {
  members: { id: number; name: string; class: string; classNo: string; entries: Entry[] }[];
  editors: { studentId: number; name: string; class: string; classNo: string }[];
  entryCount: number;
}

function SubmitDialog({ part, onClose, onDone }: { part: number; onClose: () => void; onDone: () => void }) {
  const { data, error, refresh } = usePoll<CheckResp>(`/student/submit-check?part=${part}`, 4000);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const editors = data?.editors ?? [];
  async function go() {
    setBusy(true);
    setErr("");
    try {
      await api("POST", "/student/submit", { part, confirm: true, acknowledgeEditors: ack });
      onDone();
    } catch (e) {
      const a = e as ApiError;
      setErr(a.message);
      if (a.code === "editors_active") refresh();
      setBusy(false);
    }
  }
  return (
    <Modal title={`Submit Part ${part} for your whole group?`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-600">Check everyone’s contributions first. After you submit, entries are locked until your teacher unlocks them.</p>
      {!data && !error && <Spinner />}
      {error && <ErrorBox message={error.message} onRetry={refresh} />}
      {data && (
        <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
          {data.members.map((m) => (
            <div key={m.id} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 text-sm font-bold">
                {m.name} <span className="font-normal text-slate-500">· {m.class} · No. {m.classNo}</span>
              </div>
              {m.entries.length === 0 ? (
                <p className="text-sm font-medium text-amber-700">⚠ No entries from this member.</p>
              ) : (
                <ul className="space-y-2">
                  {m.entries.map((e) => (
                    <li key={e.id} className="flex gap-2 text-sm">
                      <TagBadge tag={e.tag} />
                      <span className="line-clamp-2 flex-1 text-slate-700">
                        {e.body || <i className="text-slate-400">(no text)</i>} {e.hasImage && "📷"} {e.table && "▦"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {editors.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <b>⚠ {editors.map((e) => e.name).join(", ")} {editors.length === 1 ? "is" : "are"} still editing an unsaved entry.</b> Their latest words may not be included.
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Submit anyway
          </label>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-rose-700" role="alert">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Not yet
        </button>
        <button className="btn-accent" disabled={busy || !data || (editors.length > 0 && !ack)} onClick={go}>
          {busy ? "Submitting…" : "Submit collectively"}
        </button>
      </div>
    </Modal>
  );
}

interface RefResp {
  parts: { part: number; title: string; submitted: boolean; revision?: number; submittedAt?: number; entries: Entry[] }[];
}

/** Persistent, collapsible panel with the group's SUBMITTED earlier work, for comparing plan with findings. */
export function ReferencePanel({ part }: { part: number }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("si:refpanel");
      if (v !== null) setOpen(v === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const { data, error, refresh } = usePoll<RefResp>(open ? `/student/reference?part=${part}` : null, 15000);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem("si:refpanel", o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  void draftStorage;
  return (
    <aside className="rounded-2xl border-2 border-violet-200 bg-violet-50/60" aria-label="Reference Panel">
      <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" onClick={toggle} aria-expanded={open}>
        <span className="text-sm font-bold text-violet-900">📑 Reference Panel <span className="font-normal text-violet-700">– what your group submitted earlier</span></span>
        <span className="text-violet-700">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open && (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto border-t border-violet-200 p-4">
          {error && <ErrorBox message={error.message} onRetry={refresh} />}
          {!data && !error && <Spinner />}
          {data?.parts.map((p) => (
            <section key={p.part}>
              <h4 className="mb-2 text-sm font-bold text-slate-900">
                {p.title}
                {p.submitted && <span className="ml-2 font-normal text-slate-500">submitted{p.revision && p.revision > 1 ? ` (rev. ${p.revision})` : ""}</span>}
              </h4>
              {!p.submitted ? (
                <p className="rounded-lg bg-white p-3 text-sm text-slate-500">Your group has not submitted this part yet.</p>
              ) : (
                <ul className="space-y-2">
                  {p.entries.map((e) => (
                    <li key={e.id} className="rounded-xl border border-violet-100 bg-white p-3">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{e.author.name} · {e.author.class} · No. {e.author.classNo}</span>
                        <TagBadge tag={e.tag} />
                      </div>
                      <EntryBody body={e.body} hasImage={e.hasImage} entryId={e.id} table={e.table as TableData | null} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
