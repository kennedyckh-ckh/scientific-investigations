"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, usePoll } from "@/lib/client/api";
import { Header, Spinner, ErrorBox } from "@/components/ui";
import { PartView, ReferencePanel } from "@/components/student/part-view";
import { ClassBoard } from "@/components/student/class-board";
import type { StateResp } from "@/components/student/types";

export default function StudentPage() {
  const router = useRouter();
  const { data, error, loading, refresh } = usePoll<StateResp>("/student/state", 5000);
  const [tab, setTab] = useState<number | "class">(1);

  useEffect(() => {
    if (error && (error.status === 401 || error.status === 403)) router.replace("/");
  }, [error, router]);

  if (loading && !data) return <Spinner label="Opening your workspace…" />;
  if (!data)
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorBox message={error?.message || "Could not load your workspace."} onRetry={refresh} />
      </div>
    );

  const current = typeof tab === "number" ? data.parts.find((p) => p.part === tab) : undefined;
  const hasRef = current && !current.locked && current.part > 1;

  return (
    <div className="min-h-screen">
      <Header
        title={data.session.title}
        sub={`${data.student.name} · ${data.student.class} · No. ${data.student.classNo} · ${data.group.name}`}
        right={
          <>
            <div className="hidden items-center gap-1 sm:flex" aria-label="Group members">
              {data.group.members.map((m) => (
                <span key={m.id} title={`${m.name} (${m.class}/${m.classNo})${m.online ? " – online" : ""}`} className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${m.me ? "bg-blue-700 text-white" : "bg-violet-100 text-violet-800"} ${m.online ? "ring-2 ring-emerald-400" : "opacity-70"}`}>
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
            <button className="btn-ghost btn-sm" onClick={async () => { await api("POST", "/auth/logout").catch(() => {}); router.push("/"); }}>
              Leave
            </button>
          </>
        }
      />
      {data.session.archived && <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">This session has been archived. You can no longer make changes.</div>}

      <nav className="border-b border-slate-200 bg-white" aria-label="Parts">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
          {data.parts.map((p) => (
            <button key={p.part} onClick={() => setTab(p.part)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === p.part ? "border-blue-700 text-blue-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {p.locked ? "🔒 " : p.submission?.status === "submitted" ? "✓ " : ""}
              Part {p.part}
              <span className="ml-1 hidden font-normal sm:inline">· {p.title.split(": ")[1]}</span>
            </button>
          ))}
          <button onClick={() => setTab("class")} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === "class" ? "border-violet-600 text-violet-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            📣 Class board
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className={hasRef ? "grid gap-6 xl:grid-cols-[1fr_380px]" : ""}>
          <div>
            {/* All unlocked parts stay mounted so nothing typed is lost when switching tabs. */}
            {data.parts.map((p) => (
              <div key={p.part} hidden={tab !== p.part}>
                <PartView info={p} studentId={data.student.id} active={tab === p.part} onChanged={refresh} />
              </div>
            ))}
            {tab === "class" && <ClassBoard />}
          </div>
          {hasRef && current && (
            <div className="xl:sticky xl:top-4 xl:self-start">
              <ReferencePanel part={current.part} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
