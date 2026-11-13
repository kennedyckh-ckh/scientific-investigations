"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, usePoll, fmtTime, ApiError } from "@/lib/client/api";
import { StaffShell } from "@/components/staff-shell";
import { Spinner, ErrorBox, Empty, Modal, Field, useToast } from "@/components/ui";

interface Tpl {
  id: number;
  title: string;
  version: number;
  updatedAt: number;
  assignedTo: number;
}

export default function EducatorHome() {
  return <StaffShell role="educator">{() => <Dashboard />}</StaffShell>;
}

function Dashboard() {
  const router = useRouter();
  const toast = useToast();
  const tpls = usePoll<{ templates: Tpl[] }>("/educator/templates", 0);
  const teachers = usePoll<{ teachers: { id: number; name: string; email: string }[] }>("/educator/teachers", 0);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  async function create() {
    try {
      const r = await api<{ id: number }>("POST", "/educator/templates", { title });
      router.push(`/educator/templates/${r.id}`);
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  async function del(t: Tpl) {
    if (!confirm(`Delete “${t.title}”? Teachers who already imported it keep their own copies; unimported shares disappear.`)) return;
    try {
      await api("DELETE", `/educator/templates/${t.id}`);
      tpls.refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Investigation templates</h1>
            <p className="text-sm text-slate-600">Reusable resource packages you can share with the teachers you support. You can’t see or change their live sessions.</p>
          </div>
          <button className="btn-primary" onClick={() => { setCreating(true); setTitle(""); }}>
            + New template
          </button>
        </div>
        {tpls.loading && !tpls.data && <Spinner />}
        {tpls.error && !tpls.data && <ErrorBox message={tpls.error.message} onRetry={tpls.refresh} />}
        {tpls.data && tpls.data.templates.length === 0 && <Empty>No templates yet. Create your first one.</Empty>}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tpls.data?.templates.map((t) => (
            <article key={t.id} className="card flex flex-col gap-3">
              <Link href={`/educator/templates/${t.id}`} className="text-lg font-bold leading-snug hover:text-blue-700">
                {t.title}
              </Link>
              <p className="text-xs text-slate-500">
                Version {t.version} · updated {fmtTime(t.updatedAt)}
              </p>
              <span className={`badge self-start ${t.assignedTo ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-500"}`}>{t.assignedTo ? `Shared with ${t.assignedTo} teacher${t.assignedTo === 1 ? "" : "s"}` : "Not shared yet"}</span>
              <div className="mt-auto flex gap-2">
                <Link href={`/educator/templates/${t.id}`} className="btn-primary btn-sm">
                  Edit &amp; share
                </Link>
                <button className="btn-ghost btn-sm text-rose-700" onClick={() => del(t)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-bold">Teachers you support</h2>
        {teachers.data?.teachers.length ? (
          <ul className="flex flex-wrap gap-2">
            {teachers.data.teachers.map((t) => (
              <li key={t.id} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">
                {t.name} <span className="text-slate-400">{t.email}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No teachers have been assigned to you yet.</p>
        )}
      </section>
      {creating && (
        <Modal title="New template" onClose={() => setCreating(false)}>
          <Field label="Session title for this investigation">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} autoFocus placeholder="e.g. Which paper towel absorbs the most water?" />
          </Field>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!title.trim()} onClick={create}>
              Create
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
