"use client";
import { useState, use } from "react";
import { useRouter } from "next/navigation";
import { api, usePoll, ApiError } from "@/lib/client/api";
import { StaffShell } from "@/components/staff-shell";
import { Spinner, ErrorBox, Modal, Field, useToast } from "@/components/ui";
import { Monitor } from "@/components/teacher/monitor";
import { Setup } from "@/components/teacher/setup";
import { Groups } from "@/components/teacher/groups";
import { Contributions } from "@/components/teacher/contributions";
import { Sharing, ExportTab } from "@/components/teacher/sharing";
import { AiTab } from "@/components/teacher/ai-tab";
import type { SessionDetail } from "@/components/teacher/types";

const TABS = [
  ["monitor", "Live monitor"],
  ["setup", "Setup"],
  ["groups", "Groups"],
  ["contrib", "Contributions"],
  ["sharing", "Sharing"],
  ["ai", "AI analysis"],
  ["export", "Export"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StaffShell role="teacher">{() => <Inner id={id} />}</StaffShell>;
}

function Inner({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data: s, error, loading, refresh } = usePoll<SessionDetail>(`/teacher/sessions/${id}`, 0);
  const [tab, setTab] = useState<Tab>("monitor");
  const [focus, setFocus] = useState<{ groupId: number; part: number } | null>(null);
  const [del, setDel] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");

  if (loading && !s) return <Spinner />;
  if (error || !s) return <div className="mx-auto max-w-lg p-8"><ErrorBox message={error?.message || "Session not found"} onRetry={refresh} /></div>;
  const archived = s.status === "archived";

  async function archive(v: boolean) {
    if (v && !confirm("Archive this session? Students will no longer be able to join or edit. You can restore it later.")) return;
    try {
      await api("POST", `/teacher/sessions/${id}/${v ? "archive" : "restore"}`);
      toast(v ? "Session archived" : "Session restored");
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  async function remove() {
    try {
      await api("DELETE", `/teacher/sessions/${id}`, { confirmTitle });
      router.push("/teacher");
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{s.title}</h1>
          <p className="text-sm text-slate-500">
            Join code <span className="font-mono font-bold text-blue-800">{s.joinCode}</span> · {archived ? "Archived" : "Live"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-accent" href={`/teacher/sessions/${s.id}/projector`} target="_blank" rel="noopener noreferrer">
            📽 Projector view
          </a>
          {archived ? (
            <>
              <button className="btn-ghost" onClick={() => archive(false)}>
                Restore
              </button>
              <button className="btn-danger" onClick={() => { setDel(true); setConfirmTitle(""); }}>
                Delete…
              </button>
            </>
          ) : (
            <button className="btn-ghost" onClick={() => archive(true)}>
              Archive
            </button>
          )}
        </div>
      </div>
      {archived && <div className="mb-4 rounded-xl bg-amber-100 p-3 text-sm font-medium text-amber-900">This session is archived: read-only for you, closed to students. Restore it to make changes, or delete it permanently.</div>}

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Session sections">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === k ? "border-blue-700 text-blue-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "monitor" && <Monitor session={s} onSessionChanged={refresh} onRead={(groupId, part) => { setFocus({ groupId, part }); setTab("contrib"); }} />}
      {tab === "setup" && <Setup session={s} onSaved={refresh} />}
      {tab === "groups" && <Groups session={s} onSaved={refresh} />}
      {tab === "contrib" && <Contributions session={s} focus={focus} />}
      {tab === "sharing" && <Sharing session={s} onSaved={refresh} />}
      {tab === "ai" && <AiTab session={s} />}
      {tab === "export" && <ExportTab session={s} />}

      {del && (
        <Modal title="Delete this session permanently?" onClose={() => setDel(false)}>
          <p className="mb-3 text-sm text-slate-600">All groups, student entries, pictures, shared items and AI drafts will be deleted and cannot be recovered. Export first if you need a copy.</p>
          <Field label={`Type the session title to confirm: ${s.title}`}>
            <input className="input" value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} autoFocus />
          </Field>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setDel(false)}>
              Cancel
            </button>
            <button className="btn-danger" disabled={confirmTitle !== s.title} onClick={remove}>
              Delete forever
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
