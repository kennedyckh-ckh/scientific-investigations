"use client";
import { use, useEffect, useState } from "react";
import { api, usePoll, fmtTime, ApiError } from "@/lib/client/api";
import { StaffShell } from "@/components/staff-shell";
import { Spinner, ErrorBox, Field, useToast } from "@/components/ui";
import { PART_TITLES } from "@/lib/constants";

interface PartT {
  part: number;
  instructions: string;
  webLink: string;
  questions: string[];
}
interface Detail {
  id: number;
  title: string;
  pedagogyNotes: string;
  aiCriteria: string;
  version: number;
  updatedAt: number;
  parts: PartT[];
  assignments: { id: number; teacherId: number; teacher: string; email: string; note: string; refLinks: { label: string; url: string }[]; assignedAt: number }[];
}

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StaffShell role="educator">{() => <Editor id={id} />}</StaffShell>;
}

function Editor({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, refresh } = usePoll<Detail>(`/educator/templates/${id}`, 0);
  const teachers = usePoll<{ teachers: { id: number; name: string; email: string }[] }>("/educator/teachers", 0);
  const [f, setF] = useState<Detail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && !dirty) setF(data);
  }, [data, dirty]);

  if (loading && !f) return <Spinner />;
  if (!f) return <div className="mx-auto max-w-lg p-8"><ErrorBox message={error?.message || "Template not found"} onRetry={refresh} /></div>;

  const upd = (patch: Partial<Detail>) => { setF({ ...f, ...patch }); setDirty(true); };
  const updPart = (i: number, patch: Partial<PartT>) => upd({ parts: f.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function save() {
    setBusy(true);
    try {
      await api("PUT", `/educator/templates/${id}`, { title: f!.title, pedagogyNotes: f!.pedagogyNotes, aiCriteria: f!.aiCriteria, parts: f!.parts });
      setDirty(false);
      toast("Template saved");
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Edit template</h1>
          <p className="text-sm text-slate-500">Version {f.version} · last saved {fmtTime(f.updatedAt)}. Teachers import a <b>copy</b>, so later edits never change sessions already running.</p>
        </div>
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : dirty ? "Save template" : "Saved ✓"}
        </button>
      </div>

      <section className="card space-y-4">
        <Field label="Session title">
          <input className="input" value={f.title} onChange={(e) => upd({ title: e.target.value })} maxLength={150} />
        </Field>
        <Field label="Pedagogical notes / rationale for the teacher" hint="Shown to teachers only. Explain why the investigation is designed this way and what to watch for.">
          <textarea className="input min-h-[110px]" value={f.pedagogyNotes} onChange={(e) => upd({ pedagogyNotes: e.target.value })} maxLength={6000} />
        </Field>
        <Field label="Recommended AI analysis criteria" hint="Pre-fills the teacher’s AI criteria.">
          <textarea className="input min-h-[70px]" value={f.aiCriteria} onChange={(e) => upd({ aiCriteria: e.target.value })} maxLength={2000} />
        </Field>
      </section>

      {f.parts.map((p, i) => (
        <section key={p.part} className="card space-y-4">
          <h2 className="text-lg font-bold">{PART_TITLES[p.part]}</h2>
          <Field label="Pre-populated instructions">
            <textarea className="input min-h-[90px]" value={p.instructions} onChange={(e) => updPart(i, { instructions: e.target.value })} maxLength={5000} />
          </Field>
          <Field label="External web link">
            <input className="input" value={p.webLink} onChange={(e) => updPart(i, { webLink: e.target.value })} placeholder="https://…" maxLength={500} />
          </Field>
          <div>
            <span className="label">Guiding questions</span>
            <ol className="space-y-2">
              {p.questions.map((q, qi) => (
                <li key={qi} className="flex gap-2">
                  <input className="input" value={q} maxLength={500} aria-label={`Part ${p.part} question ${qi + 1}`} onChange={(e) => updPart(i, { questions: p.questions.map((x, k) => (k === qi ? e.target.value : x)) })} />
                  <button className="btn-ghost btn-sm text-rose-700" aria-label="Remove question" onClick={() => updPart(i, { questions: p.questions.filter((_, k) => k !== qi) })}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
            <button className="btn-ghost btn-sm mt-2" disabled={p.questions.length >= 20} onClick={() => updPart(i, { questions: [...p.questions, ""] })}>
              + Add question
            </button>
          </div>
        </section>
      ))}

      <Assign templateId={id} detail={f} dirty={dirty} teachers={teachers.data?.teachers ?? []} onChanged={refresh} />
    </main>
  );
}

function Assign({ templateId, detail, dirty, teachers, onChanged }: { templateId: string; detail: Detail; dirty: boolean; teachers: { id: number; name: string; email: string }[]; onChanged: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  async function assign() {
    setBusy(true);
    try {
      await api("POST", `/educator/templates/${templateId}/assign`, { teacherIds: Array.from(sel), note, refLinks: links.filter((l) => l.url.trim()) });
      toast(`Shared with ${sel.size} teacher${sel.size === 1 ? "" : "s"}`);
      setSel(new Set());
      onChanged();
    } catch (e) {
      toast((e as ApiError).message, "err");
    } finally {
      setBusy(false);
    }
  }
  async function unassign(teacherId: number) {
    try {
      await api("DELETE", `/educator/templates/${templateId}/assign/${teacherId}`);
      onChanged();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  return (
    <section className="card space-y-4 border-violet-200">
      <h2 className="text-lg font-bold">Share with teachers</h2>
      {dirty && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">You have unsaved changes. Save the template first so teachers get the latest version.</p>}
      <div>
        <span className="label">Choose teachers you support</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {teachers.map((t) => (
            <label key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input type="checkbox" checked={sel.has(t.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} />
              {t.name} <span className="text-xs text-slate-400">{t.email}</span>
            </label>
          ))}
        </div>
      </div>
      <Field label="Message to the teacher (optional)">
        <textarea className="input min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div>
        <span className="label">Supporting reference links (optional)</span>
        {links.map((l, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input className="input" placeholder="Label" value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input" placeholder="https://…" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <button className="btn-ghost btn-sm" aria-label="Remove link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn-ghost btn-sm" onClick={() => setLinks([...links, { label: "", url: "" }])}>
          + Add link
        </button>
      </div>
      <button className="btn-accent" disabled={busy || dirty || sel.size === 0} onClick={assign}>
        Share with {sel.size || ""} selected
      </button>

      {detail.assignments.length > 0 && (
        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Currently shared with</h3>
          <ul className="space-y-2">
            {detail.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                <span>
                  <b>{a.teacher}</b> <span className="text-slate-400">{a.email}</span>
                  <span className="block text-xs text-slate-500">shared {fmtTime(a.assignedAt)}{a.refLinks.length ? ` · ${a.refLinks.length} link(s)` : ""}</span>
                </span>
                <button className="btn-ghost btn-sm" onClick={() => unassign(a.teacherId)}>
                  Stop sharing
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
