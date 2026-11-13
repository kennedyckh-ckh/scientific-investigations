"use client";
import { useState } from "react";
import { api, usePoll, ApiError } from "@/lib/client/api";
import { Spinner, ErrorBox, Empty, Field, useToast, TagBadge } from "@/components/ui";
import { AiView, type AiContent } from "@/components/ai-view";
import { PART_TITLES } from "@/lib/constants";
import type { SessionDetail, TEntry } from "./types";

interface Output {
  id: number;
  kind: "group_summary" | "cross_group" | "discussion_points";
  part: number;
  groupName: string | null;
  provider: string;
  status: "draft" | "edited" | "published" | "revealed";
  content: AiContent;
  citedIds: number[];
  createdAt: number;
}

const KIND_LABEL: Record<Output["kind"], string> = {
  group_summary: "Group summary",
  cross_group: "Cross-group comparison",
  discussion_points: "Discussion points",
};
const STATUS_STYLE: Record<Output["status"], string> = {
  draft: "bg-slate-100 text-slate-700",
  edited: "bg-amber-100 text-amber-800",
  published: "bg-emerald-100 text-emerald-800",
  revealed: "bg-violet-100 text-violet-800",
};
const STATUS_TEXT: Record<Output["status"], string> = {
  draft: "Draft – only you can see this",
  edited: "Edited draft – only you can see this",
  published: "Published to class",
  revealed: "Revealed to class",
};

export function AiTab({ session }: { session: SessionDetail }) {
  const toast = useToast();
  const outs = usePoll<{ outputs: Output[] }>(`/teacher/sessions/${session.id}/ai`, 0);
  const ents = usePoll<{ entries: TEntry[] }>(`/teacher/sessions/${session.id}/entries`, 20000);
  const [part, setPart] = useState(1);
  const [groupId, setGroupId] = useState<string>(session.groups[0] ? String(session.groups[0].id) : "");
  const [criteria, setCriteria] = useState(session.aiCriteria);
  const [busy, setBusy] = useState<string | null>(null);
  const archived = session.status === "archived";
  const entryMap = new Map((ents.data?.entries ?? []).map((e) => [e.id, e]));

  async function generate(kind: Output["kind"]) {
    setBusy(kind);
    try {
      await api("POST", `/teacher/sessions/${session.id}/ai/generate`, { kind, part, groupId: kind === "group_summary" ? Number(groupId) : undefined, criteria });
      toast("Draft created. Review it before sharing.");
      outs.refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    } finally {
      setBusy(null);
    }
  }


  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <b>Mock analyser in use.</b> Drafts come from a built-in rule-based analyser, not a language model, so you can test the whole review-and-publish workflow. 
        Every point cites its source entries (E-numbers), disagreements are kept, student names are replaced with neutral labels, and nothing reaches students until you publish or reveal it.
      </div>

      <section className="card space-y-4">
        <h3 className="text-lg font-bold">Create an AI draft</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Stage to analyse">
            <select className="input" value={part} onChange={(e) => setPart(Number(e.target.value))}>
              {[1, 2, 3].map((p) => (
                <option key={p} value={p}>
                  {PART_TITLES[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Group (for a group summary)">
            <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {session.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Your criteria for the analysis" hint="Always prioritised: divergent findings, uncontrolled variables, evidence-to-claim gaps, misconceptions. Student text is treated strictly as data.">
          <textarea className="input min-h-[70px]" value={criteria} onChange={(e) => setCriteria(e.target.value)} maxLength={2000} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={archived || !!busy || !groupId} onClick={() => generate("group_summary")}>
            {busy === "group_summary" ? "Working…" : "Summarise one group"}
          </button>
          <button className="btn-primary" disabled={archived || !!busy} onClick={() => generate("cross_group")}>
            {busy === "cross_group" ? "Working…" : "Compare all groups"}
          </button>
          <button className="btn-accent" disabled={archived || !!busy} onClick={() => generate("discussion_points")}>
            {busy === "discussion_points" ? "Working…" : "Suggest discussion questions"}
          </button>
        </div>
      </section>

      {outs.loading && !outs.data && <Spinner />}
      {outs.error && !outs.data && <ErrorBox message={outs.error.message} onRetry={outs.refresh} />}
      {outs.data && outs.data.outputs.length === 0 && <Empty>No drafts yet. Create one above.</Empty>}
      <div className="space-y-5">
        {outs.data?.outputs.map((o) => (
          <OutputCard key={o.id} o={o} sessionId={session.id} entryMap={entryMap} archived={archived} onChanged={outs.refresh} />
        ))}
      </div>
    </div>
  );
}

function OutputCard({ o, sessionId, entryMap, archived, onChanged }: { o: Output; sessionId: number; entryMap: Map<number, TEntry>; archived: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AiContent>(o.content);
  const [reviewed, setReviewed] = useState(false);
  const [showSrc, setShowSrc] = useState(false);
  const live = o.status === "published" || o.status === "revealed";
  const isQ = o.kind === "discussion_points";

  async function call(method: string, path: string, body?: unknown, ok?: string) {
    try {
      await api(method, `/teacher/sessions/${sessionId}/ai/${o.id}${path}`, body);
      if (ok) toast(ok);
      setEditing(false);
      setReviewed(false);
      onChanged();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }

  return (
    <article className={`card space-y-4 ${live ? "border-emerald-300" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{KIND_LABEL[o.kind]}</span>
          {o.groupName && <span className="text-slate-500">· {o.groupName}</span>}
          <span className="text-slate-500">· Part {o.part}</span>
          <span className={`badge ${STATUS_STYLE[o.status]}`}>{STATUS_TEXT[o.status]}</span>
        </div>
        <span className="text-xs text-slate-400">{o.provider}</span>
      </div>

      {editing ? (
        <ContentEditor content={draft} onChange={setDraft} />
      ) : (
        <AiView content={o.content} />
      )}

      <div>
        <button className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => setShowSrc((v) => !v)}>
          {showSrc ? "Hide" : "Show"} the {o.citedIds.length} source entries cited
        </button>
        {showSrc && (
          <ul className="mt-2 space-y-1.5">
            {o.citedIds.map((id) => {
              const e = entryMap.get(id);
              return (
                <li key={id} className="flex gap-2 rounded-lg bg-slate-50 p-2 text-xs">
                  <span className="font-mono font-bold text-slate-600">E{id}</span>
                  {e ? (
                    <span className="flex-1">
                      <TagBadge tag={e.tag} /> <b>{e.author.name}</b> ({e.groupName}): {e.body.slice(0, 160)}
                    </span>
                  ) : (
                    <span className="italic text-slate-400">(entry removed)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!archived && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {editing ? (
            <>
              <button className="btn-primary btn-sm" onClick={() => call("PATCH", "", { content: draft }, "Edits saved")}>
                Save edits
              </button>
              <button className="btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(o.content); }}>
                Cancel
              </button>
            </>
          ) : live ? (
            <button className="btn-ghost btn-sm" onClick={() => call("POST", "/unpublish", {}, "Hidden from students again")}>
              Take back from class
            </button>
          ) : (
            <>
              <button className="btn-ghost btn-sm" onClick={() => { setDraft(o.content); setEditing(true); }}>
                ✎ Edit draft
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                I have read this{isQ ? "" : " and checked it quotes nothing I don’t want the class to see"}
              </label>
              {isQ ? (
                <button className="btn-accent btn-sm" disabled={!reviewed} onClick={() => call("POST", "/reveal", { reviewed }, "Discussion questions revealed to the class")}>
                  💡 Reveal discussion questions
                </button>
              ) : (
                <button className="btn-primary btn-sm" disabled={!reviewed} onClick={() => call("POST", "/publish", { reviewed }, "Summary published to the class")}>
                  Publish summary
                </button>
              )}
              <button className="btn-ghost btn-sm text-rose-700" onClick={() => confirm("Delete this draft?") && call("DELETE", "", undefined, "Draft deleted")}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ContentEditor({ content, onChange }: { content: AiContent; onChange: (c: AiContent) => void }) {
  const setItem = (si: number, ii: number, text: string) => onChange({ ...content, sections: content.sections.map((s, a) => (a !== si ? s : { ...s, items: s.items.map((it, b) => (b === ii ? { ...it, text } : it)) })) });
  const delItem = (si: number, ii: number) =>
    onChange({
      ...content,
      sections: content.sections.map((s, a) => (a !== si ? s : { ...s, items: s.items.filter((_, b) => b !== ii) })).filter((s) => s.items.length > 0),
    });
  return (
    <div className="space-y-4 rounded-xl bg-blue-50/50 p-4">
      <Field label="Title">
        <input className="input" value={content.title} onChange={(e) => onChange({ ...content, title: e.target.value })} />
      </Field>
      {content.sections.map((s, si) => (
        <div key={si}>
          <input className="input mb-2 font-semibold" value={s.heading} onChange={(e) => onChange({ ...content, sections: content.sections.map((x, a) => (a === si ? { ...x, heading: e.target.value } : x)) })} aria-label="Section heading" />
          <ul className="space-y-2">
            {s.items.map((it, ii) => (
              <li key={ii} className="flex gap-2">
                <div className="flex-1">
                  <textarea className="input min-h-[60px]" value={it.text} onChange={(e) => setItem(si, ii, e.target.value)} />
                  <div className="mt-1 text-xs text-slate-500">Sources (kept): {it.cites.map((c) => `E${c}`).join(", ")}</div>
                </div>
                <button className="btn-ghost btn-sm self-start text-rose-700" onClick={() => delItem(si, ii)} aria-label="Remove item">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-slate-500">Every point must keep at least one source entry. Questions must still end with a question mark.</p>
    </div>
  );
}
