"use client";
import { use, useEffect, useState } from "react";
import { usePoll } from "@/lib/client/api";
import { EntryBody, TagBadge, Spinner, ErrorBox } from "@/components/ui";
import { AiView, type AiContent } from "@/components/ai-view";
import type { TableData } from "@/components/ui";

interface Proj {
  title: string;
  anonymised: boolean;
  shares: { shareId: number; entryId: number; label: string; part: number; tag: string | null; body: string; hasImage: boolean; table: TableData | null; critiques: { id: number; promptLabel: string; body: string; authorLabel: string }[] }[];
  ai: { id: number; kind: string; part: number; content: AiContent }[];
}

/** Classroom Projector View: only PUBLISHED content. Drafts, unshared groups and teacher controls are never fetched. */
export default function ProjectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, refresh } = usePoll<Proj>(`/teacher/sessions/${id}/projector`, 3000);
  const [hideBar, setHideBar] = useState(false);
  useEffect(() => {
    if (!hideBar) return;
    const h = () => setHideBar(false);
    window.addEventListener("mousemove", h, { once: true });
    return () => window.removeEventListener("mousemove", h);
  }, [hideBar]);

  if (error && !data) return <div className="mx-auto max-w-lg p-8"><ErrorBox message={error.message} onRetry={refresh} /></div>;
  if (!data) return <Spinner />;
  const discussion = data.ai.filter((a) => a.kind === "discussion_points");
  const summaries = data.ai.filter((a) => a.kind !== "discussion_points");
  const empty = !data.shares.length && !data.ai.length;

  return (
    <div className="projector min-h-screen bg-white px-[4vw] py-[3vh] text-slate-900">
      <div className={`mb-2 flex flex-wrap items-start justify-between gap-3 ${hideBar ? "invisible" : ""}`}>
        <span className="text-sm font-semibold uppercase tracking-widest text-slate-400">Projector view · published content only</span>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>
            Full screen
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setHideBar(true)}>
            Hide buttons
          </button>
          <button className="btn-ghost btn-sm" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </div>
      <h1 className="mb-[3vh] text-[1.7em] font-extrabold text-blue-900">{data.title}</h1>

      {empty && (
        <div className="flex min-h-[60vh] items-center justify-center text-center text-[1.2em] text-slate-400">Nothing has been published yet.</div>
      )}

      {discussion.length > 0 && (
        <section className="mb-[4vh]">
          <h2 className="mb-3 text-[1.3em] font-extrabold text-violet-800">💬 Let’s discuss</h2>
          <div className="space-y-6 rounded-3xl bg-violet-50 p-[2vw]">
            {discussion.map((d) => (
              <AiView key={d.id} content={d.content} big />
            ))}
          </div>
        </section>
      )}
      {summaries.length > 0 && (
        <section className="mb-[4vh]">
          <h2 className="mb-3 text-[1.3em] font-extrabold text-blue-800">Summaries</h2>
          <div className="space-y-6">
            {summaries.map((d) => (
              <div key={d.id} className="rounded-3xl border-2 border-blue-100 p-[2vw]">
                <AiView content={d.content} big />
              </div>
            ))}
          </div>
        </section>
      )}
      {data.shares.length > 0 && (
        <section>
          <h2 className="mb-3 text-[1.3em] font-extrabold text-slate-800">Student responses</h2>
          <div className="grid gap-[2vw] lg:grid-cols-2">
            {data.shares.map((s) => (
              <article key={s.shareId} className="rounded-3xl border-2 border-slate-200 p-[1.6vw]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[1.1em] font-extrabold text-violet-800">{s.label}</h3>
                  <TagBadge tag={s.tag} />
                </div>
                <div className="text-[1em]">
                  <EntryBody body={s.body} hasImage={s.hasImage} entryId={s.entryId} table={s.table} />
                </div>
                {s.critiques.length > 0 && (
                  <ul className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-[0.8em]">
                    {s.critiques.map((c) => (
                      <li key={c.id} className="rounded-xl bg-slate-50 p-3">
                        <b className="text-violet-700">{c.promptLabel}:</b> {c.body}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
