"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Field, useToast } from "@/components/ui";
import { PART_TITLES } from "@/lib/constants";
import type { SessionDetail, PartCfg } from "./types";

export function Setup({ session, onSaved }: { session: SessionDetail; onSaved: () => void }) {
  const archived = session.status === "archived";
  return (
    <div className="space-y-6">
      {session.source && (
        <div className="rounded-xl bg-violet-50 p-4 text-sm text-violet-950">
          Imported from the Teacher Educator template <b>“{session.source.title}”</b> (version {session.source.importedVersion}). This session is your own copy; edits here never change the original.
          {session.source.currentVersion !== null && session.source.currentVersion !== session.source.importedVersion && <span className="ml-1 text-amber-700">The master has since been updated (v{session.source.currentVersion}); import it again for a new session if you want the changes.</span>}
          {session.pedagogyNotes && (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">Pedagogical notes from your Teacher Educator</summary>
              <p className="mt-2 whitespace-pre-wrap">{session.pedagogyNotes}</p>
            </details>
          )}
        </div>
      )}
      <SessionSettings session={session} onSaved={onSaved} disabled={archived} />
      {session.parts.map((p) => (
        <PartEditor key={p.part} sessionId={session.id} cfg={p} onSaved={onSaved} disabled={archived} />
      ))}
    </div>
  );
}

function SessionSettings({ session, onSaved, disabled }: { session: SessionDetail; onSaved: () => void; disabled: boolean }) {
  const toast = useToast();
  const [title, setTitle] = useState(session.title);
  const [criteria, setCriteria] = useState(session.aiCriteria);
  const [prompts, setPrompts] = useState(session.critiquePrompts);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("PATCH", `/teacher/sessions/${session.id}`, { title, aiCriteria: criteria, critiquePrompts: prompts });
      toast("Session settings saved");
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-4">
      <h3 className="text-lg font-bold">Session settings</h3>
      <Field label="Session title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={disabled} maxLength={150} />
      </Field>
      <div>
        <span className="label">Peer critique prompts students can use on shared responses</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {prompts.map((p, i) => (
            <label key={p.key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input type="checkbox" checked={p.enabled} disabled={disabled} onChange={(e) => setPrompts((ps) => ps.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
              {p.label}
            </label>
          ))}
        </div>
      </div>
      <Field label="Criteria for AI analysis" hint="What should the AI look for? It always prioritises divergent findings, uncontrolled variables, evidence-to-claim gaps and misconceptions.">
        <textarea className="input min-h-[80px]" value={criteria} onChange={(e) => setCriteria(e.target.value)} disabled={disabled} maxLength={2000} />
      </Field>
      <button className="btn-primary" disabled={busy || disabled} onClick={save}>
        Save settings
      </button>
    </section>
  );
}

function PartEditor({ sessionId, cfg, onSaved, disabled }: { sessionId: number; cfg: PartCfg; onSaved: () => void; disabled: boolean }) {
  const toast = useToast();
  const [instructions, setInstructions] = useState(cfg.instructions);
  const [link, setLink] = useState(cfg.webLink);
  const [qs, setQs] = useState<string[]>(cfg.questions.map((q) => q.text));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setInstructions(cfg.instructions);
      setLink(cfg.webLink);
      setQs(cfg.questions.map((q) => q.text));
    }
  }, [cfg, dirty]);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };
  async function save() {
    setBusy(true);
    try {
      await api("PUT", `/teacher/sessions/${sessionId}/parts/${cfg.part}`, { instructions, webLink: link, questions: qs.filter((q) => q.trim()) });
      setDirty(false);
      toast(`Part ${cfg.part} saved`);
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, "err");
    } finally {
      setBusy(false);
    }
  }
  const move = (i: number, d: number) => {
    const n = qs.slice();
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    touch(setQs)(n);
  };
  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">{PART_TITLES[cfg.part]}</h3>
        {dirty && <span className="badge bg-amber-100 text-amber-800">Unsaved changes</span>}
      </div>
      <Field label="Instructions for students">
        <textarea className="input min-h-[110px]" value={instructions} onChange={(e) => touch(setInstructions)(e.target.value)} disabled={disabled} maxLength={5000} />
      </Field>
      <Field label="External web link" hint="Opens in a new tab for students. Must start with http:// or https://">
        <input className="input" value={link} onChange={(e) => touch(setLink)(e.target.value)} disabled={disabled} placeholder="https://…" maxLength={500} />
      </Field>
      <div>
        <span className="label">Guiding questions</span>
        <ol className="space-y-2">
          {qs.map((q, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs font-bold text-slate-400">{i + 1}</span>
              <input className="input" value={q} onChange={(e) => touch(setQs)(qs.map((x, j) => (j === i ? e.target.value : x)))} disabled={disabled} maxLength={500} aria-label={`Guiding question ${i + 1}`} />
              <button className="btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label="Move up">
                ↑
              </button>
              <button className="btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={disabled || i === qs.length - 1} aria-label="Move down">
                ↓
              </button>
              <button className="btn-ghost btn-sm text-rose-700" onClick={() => touch(setQs)(qs.filter((_, j) => j !== i))} disabled={disabled} aria-label="Remove question">
                ✕
              </button>
            </li>
          ))}
        </ol>
        <button className="btn-ghost btn-sm mt-2" disabled={disabled || qs.length >= 20} onClick={() => touch(setQs)([...qs, ""])}>
          + Add question
        </button>
      </div>
      <button className="btn-primary" disabled={busy || disabled || !dirty} onClick={save}>
        {busy ? "Saving…" : `Save Part ${cfg.part}`}
      </button>
    </section>
  );
}
