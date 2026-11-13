"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, usePoll, fmtTime, ApiError } from "@/lib/client/api";
import { StaffShell } from "@/components/staff-shell";
import { Spinner, ErrorBox, Empty, Modal, Field, useToast } from "@/components/ui";

interface SessionRow {
  id: number;
  title: string;
  joinCode: string;
  status: "active" | "archived";
  groups: number;
  students: number;
  fromTemplate: boolean;
  createdAt: number;
}
interface Assigned {
  assignmentId: number;
  templateId: number;
  title: string;
  pedagogyNotes: string;
  version: number;
  note: string;
  refLinks: { label: string; url: string }[];
  educator: string;
  assignedAt: number;
  parts: { part: number; instructions: string; webLink: string; questions: string[] }[];
}

export default function TeacherHome() {
  return <StaffShell role="teacher">{() => <Dashboard />}</StaffShell>;
}

function Dashboard() {
  const router = useRouter();
  const toast = useToast();
  const sessions = usePoll<{ sessions: SessionRow[] }>("/teacher/sessions", 10000);
  const tpls = usePoll<{ templates: Assigned[] }>("/teacher/assigned-templates", 0);
  const [creating, setCreating] = useState<null | { assignment?: Assigned }>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Assigned | null>(null);

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ id: number }>("POST", "/teacher/sessions", { title, assignmentId: creating?.assignment?.assignmentId });
      router.push(`/teacher/sessions/${r.id}`);
    } catch (e) {
      toast((e as ApiError).message, "err");
      setBusy(false);
    }
  }
  const active = sessions.data?.sessions.filter((s) => s.status === "active") ?? [];
  const archived = sessions.data?.sessions.filter((s) => s.status === "archived") ?? [];

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold">Your sessions</h1>
          <button className="btn-primary" onClick={() => { setCreating({}); setTitle(""); }}>
            + New session
          </button>
        </div>
        {sessions.loading && !sessions.data && <Spinner />}
        {sessions.error && !sessions.data && <ErrorBox message={sessions.error.message} onRetry={sessions.refresh} />}
        {sessions.data && active.length === 0 && <Empty>No live sessions yet. Create one, or import a template shared by your Teacher Educator below.</Empty>}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {active.map((s) => (
            <SessionCard key={s.id} s={s} />
          ))}
        </div>
        {archived.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">Archived sessions ({archived.length})</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {archived.map((s) => (
                <SessionCard key={s.id} s={s} />
              ))}
            </div>
          </details>
        )}
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Assigned Templates</h2>
        <p className="mb-4 text-sm text-slate-600">Shared by your Teacher Educator. Importing makes your own copy, so you can change anything without touching the original.</p>
        {tpls.loading && !tpls.data && <Spinner />}
        {tpls.data && tpls.data.templates.length === 0 && <Empty>Nothing has been shared with you yet.</Empty>}
        <div className="grid gap-4 md:grid-cols-2">
          {tpls.data?.templates.map((t) => (
            <article key={t.assignmentId} className="card flex flex-col gap-3 border-violet-200">
              <div>
                <span className="badge bg-violet-100 text-violet-800">Shared by {t.educator}</span>
                <h3 className="mt-2 text-lg font-bold">{t.title}</h3>
                <p className="text-xs text-slate-500">Version {t.version} · shared {fmtTime(t.assignedAt)}</p>
              </div>
              {t.note && <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-950">“{t.note}”</p>}
              {t.refLinks.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {t.refLinks.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">
                        🔗 {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex gap-2">
                <button className="btn-accent btn-sm" onClick={() => { setCreating({ assignment: t }); setTitle(t.title); }}>
                  Import into a new live session
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setView(t)}>
                  Preview &amp; rationale
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {creating && (
        <Modal title={creating.assignment ? `Import “${creating.assignment.title}”` : "New session"} onClose={() => setCreating(null)}>
          <div className="space-y-4">
            <Field label="Session title">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} autoFocus placeholder="e.g. Year 8 – Period 3" />
            </Field>
            {creating.assignment && <p className="text-sm text-slate-600">Instructions, links and guiding questions are copied into your session. You can edit all of them.</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setCreating(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || !title.trim()} onClick={create}>
                {busy ? "Creating…" : "Create session"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {view && (
        <Modal title={view.title} onClose={() => setView(null)} wide>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm">
            {view.pedagogyNotes && (
              <div className="rounded-xl bg-violet-50 p-4">
                <h4 className="mb-1 font-bold text-violet-900">Pedagogical notes for you</h4>
                <p className="whitespace-pre-wrap text-violet-950">{view.pedagogyNotes}</p>
              </div>
            )}
            {view.parts.map((p) => (
              <div key={p.part}>
                <h4 className="font-bold">Part {p.part}</h4>
                <p className="whitespace-pre-wrap text-slate-700">{p.instructions || <i>(none)</i>}</p>
                {p.webLink && <p className="text-blue-700">{p.webLink}</p>}
                <ol className="mt-1 list-decimal pl-5 text-slate-700">
                  {p.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </main>
  );
}

function SessionCard({ s }: { s: SessionRow }) {
  return (
    <Link href={`/teacher/sessions/${s.id}`} className={`card block transition hover:border-blue-400 hover:shadow-md ${s.status === "archived" ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold leading-snug">{s.title}</h3>
        <span className={`badge ${s.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{s.status}</span>
      </div>
      <div className="mt-3 font-mono text-2xl font-bold tracking-[0.25em] text-blue-800">{s.joinCode}</div>
      <p className="mt-2 text-xs text-slate-500">
        {s.students} student{s.students === 1 ? "" : "s"} · {s.groups} group{s.groups === 1 ? "" : "s"}
        {s.fromTemplate && " · from template"}
      </p>
    </Link>
  );
}
