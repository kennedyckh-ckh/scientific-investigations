"use client";
import { useState } from "react";
import { api, usePoll, fmtTime, ApiError } from "@/lib/client/api";
import { Spinner, ErrorBox, Modal, Field, useToast } from "@/components/ui";
import { PART_TITLES } from "@/lib/constants";
import type { SessionDetail, StatusResp } from "./types";

const VIS = [
  { v: "hidden", label: "Hidden", hint: "Students can't see this part exists" },
  { v: "visible", label: "Locked", hint: "Students see it is coming" },
  { v: "open", label: "Open", hint: "Students can work on it" },
] as const;

export function Monitor({ session, onRead, onSessionChanged }: { session: SessionDetail; onRead: (groupId: number, part: number) => void; onSessionChanged: () => void }) {
  const toast = useToast();
  const { data, error, loading, refresh } = usePoll<StatusResp>(`/teacher/sessions/${session.id}/status`, 4000);
  const [override, setOverride] = useState<null | { part: number; message: string }>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const archived = session.status === "archived";

  async function setVis(part: number, visibility: string, ov?: { reason: string }) {
    setBusy(true);
    try {
      await api("POST", `/teacher/sessions/${session.id}/parts/${part}/visibility`, { visibility, ...(ov ? { override: true, reason: ov.reason } : {}) });
      setOverride(null);
      setReason("");
      toast(visibility === "open" ? `Part ${part} is now open to students` : `Part ${part} set to ${visibility === "visible" ? "locked" : "hidden"}`);
      refresh();
      onSessionChanged();
    } catch (e) {
      const a = e as ApiError;
      if (a.code === "groups_missing") setOverride({ part, message: a.message });
      else toast(a.message, "err");
    } finally {
      setBusy(false);
    }
  }
  async function unlock(groupId: number, part: number, name: string) {
    if (!confirm(`Unlock ${name}'s Part ${part} so they can revise it? Their submitted version is kept.`)) return;
    try {
      await api("POST", `/teacher/sessions/${session.id}/unlock-submission`, { groupId, part });
      toast(`${name} can now revise Part ${part}`);
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  async function approve(id: number) {
    try {
      await api("POST", `/teacher/sessions/${session.id}/recovery/${id}/approve`);
      toast("Device approved. The student can now continue.");
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error.message} onRetry={refresh} />;
  if (!data) return null;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="card flex flex-col items-center justify-center bg-gradient-to-br from-blue-700 to-violet-700 text-white">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-100">Students join with</div>
          <div className="my-1 font-mono text-5xl font-extrabold tracking-[0.3em]" aria-label={`Join code ${session.joinCode.split("").join(" ")}`}>{session.joinCode}</div>
          <button className="btn-ghost btn-sm mt-1" onClick={() => { navigator.clipboard?.writeText(session.joinCode); toast("Code copied"); }}>
            Copy code
          </button>
        </div>
        <div className="card">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Who has submitted?</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.summary.map((s) => (
              <div key={s.part} className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Part {s.part}</div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {s.submitted}<span className="text-base font-semibold text-slate-400"> / {s.activeGroups}</span>
                </div>
                <div className="text-xs text-slate-500">active groups submitted</div>
                {s.missing.length > 0 && s.activeGroups > 0 && <div className="mt-1 text-xs text-amber-700">Waiting: {s.missing.join(", ")}</div>}
                {s.activeGroups > 0 && s.missing.length === 0 && <div className="mt-1 text-xs text-emerald-700">All groups submitted ✓</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-bold">Release parts to students</h3>
        <div className="grid gap-3 lg:grid-cols-3">
          {data.parts.map((p) => (
            <div key={p.part} className="card">
              <div className="mb-3 text-sm font-bold">{PART_TITLES[p.part]}</div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label={`Visibility of Part ${p.part}`}>
                {VIS.map((o) => (
                  <button key={o.v} role="radio" aria-checked={p.visibility === o.v} title={o.hint} disabled={busy || archived || p.visibility === o.v} onClick={() => setVis(p.part, o.v)} className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${p.visibility === o.v ? (o.v === "open" ? "bg-emerald-600 text-white" : o.v === "visible" ? "bg-amber-500 text-white" : "bg-slate-700 text-white") : "text-slate-600 hover:bg-white"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{VIS.find((o) => o.v === p.visibility)?.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-bold">Group progress</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-3">Group</th>
                {[1, 2, 3].map((p) => (
                  <th key={p} className="p-3">Part {p}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.groups.map((g) => (
                <tr key={g.id} className="align-top">
                  <td className="p-3">
                    <div className="font-semibold">{g.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {g.members.length === 0 ? "No students yet" : g.members.map((m) => (
                        <span key={m.id} className="mr-2 inline-flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${m.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                          {m.name} ({m.class}/{m.classNo})
                        </span>
                      ))}
                    </div>
                  </td>
                  {g.parts.map((p) => {
                    const open = data.parts[p.part - 1].visibility === "open";
                    const st = p.submission.status;
                    return (
                      <td key={p.part} className="p-3">
                        {st === "submitted" ? (
                          <span className="badge bg-emerald-100 text-emerald-800">Submitted{p.submission.revision > 1 ? ` (rev ${p.submission.revision})` : ""}</span>
                        ) : st === "revising" ? (
                          <span className="badge bg-amber-100 text-amber-800">Revising (rev {p.submission.revision} kept)</span>
                        ) : p.entryCount > 0 ? (
                          <span className="badge bg-blue-100 text-blue-800">Draft</span>
                        ) : (
                          <span className="badge bg-slate-100 text-slate-500">{open ? "Not started" : "–"}</span>
                        )}
                        <div className="mt-1 text-xs text-slate-500">
                          {p.entryCount} entr{p.entryCount === 1 ? "y" : "ies"}
                          {p.editing > 0 && <span className="ml-1 text-violet-700">· ✎ editing now</span>}
                        </div>
                        <div className="mt-1.5 flex gap-1.5">
                          {p.entryCount > 0 && (
                            <button className="btn-ghost btn-sm" onClick={() => onRead(g.id, p.part)}>
                              Read
                            </button>
                          )}
                          {st === "submitted" && !archived && (
                            <button className="btn-ghost btn-sm" onClick={() => unlock(g.id, p.part, g.name)}>
                              Unlock for revision
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.recovery.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="mb-2 font-bold text-amber-900">Devices waiting for approval</h3>
          <p className="mb-3 text-xs text-amber-800">These students re-entered their name on a new device. Approve only if it is really them.</p>
          <ul className="space-y-2">
            {data.recovery.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm">
                <span>
                  <b>{r.name}</b> · {r.class} · No. {r.classNo} · {r.group} <span className="text-xs text-slate-500">({fmtTime(r.createdAt)})</span>
                </span>
                <button className="btn-primary btn-sm" onClick={() => approve(r.id)}>
                  Approve device
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.overrides.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Override log</h3>
          <ul className="space-y-1 text-sm text-slate-600">
            {data.overrides.map((o, i) => (
              <li key={i}>
                {fmtTime(o.at)} – Part {o.part} opened without: {o.missing.map((m) => m.name).join(", ")}. <i>“{o.reason}”</i>
              </li>
            ))}
          </ul>
        </section>
      )}

      {override && (
        <Modal title={`Open Part ${override.part} without every group?`} onClose={() => setOverride(null)}>
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{override.message}</p>
          <p className="mb-3 text-sm text-slate-600">You can proceed deliberately. Groups that haven’t submitted will still be able to see their earlier work, but they are not “submitted”. Your reason is recorded.</p>
          <Field label="Reason for proceeding">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus placeholder="e.g. Group B was absent today" />
          </Field>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setOverride(null)}>
              Wait for groups
            </button>
            <button className="btn-danger" disabled={busy || !reason.trim()} onClick={() => setVis(override.part, "open", { reason })}>
              Proceed anyway
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
