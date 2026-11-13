"use client";
import { api, usePoll, ApiError } from "@/lib/client/api";
import { EntryBody, TagBadge, Spinner, ErrorBox, Empty, useToast } from "@/components/ui";
import type { SessionDetail, TEntry } from "./types";

interface SharesResp {
  anonymised: boolean;
  shares: {
    shareId: number;
    seq: number;
    entry: TEntry;
    groupName: string;
    publicLabel: string;
    critiques: { id: number; promptLabel: string; body: string; hidden: boolean; author: string }[];
  }[];
}

export function Sharing({ session, onSaved }: { session: SessionDetail; onSaved: () => void }) {
  const toast = useToast();
  const { data, error, loading, refresh } = usePoll<SharesResp>(`/teacher/sessions/${session.id}/shares`, 6000);
  const archived = session.status === "archived";

  async function setAnon(v: boolean) {
    try {
      await api("PATCH", `/teacher/sessions/${session.id}`, { anonymiseSharing: v });
      toast(v ? "Responses are now anonymous to the class" : "Responses now show group names");
      onSaved();
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  async function unshare(id: number) {
    try {
      await api("DELETE", `/teacher/sessions/${session.id}/shares/${id}`);
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  async function hide(id: number, hidden: boolean) {
    try {
      await api("POST", `/teacher/sessions/${session.id}/critiques/${id}/hide`, { hidden });
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <h3 className="text-lg font-bold">Anonymised class sharing</h3>
          <p className="mt-1 text-sm text-slate-600">When on, students and the projector see “Sample Response #1, #2…” instead of group names, so the class critiques the science rather than the people. Individual student names are never shown to the class either way.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
          <span>Show group names</span>
          <button role="switch" aria-checked={session.anonymiseSharing} disabled={archived} onClick={() => setAnon(!session.anonymiseSharing)} className={`relative h-7 w-12 rounded-full transition ${session.anonymiseSharing ? "bg-violet-600" : "bg-slate-300"}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${session.anonymiseSharing ? "left-[22px]" : "left-0.5"}`} />
          </button>
          <span className={session.anonymiseSharing ? "text-violet-700" : "text-slate-400"}>Anonymous</span>
        </label>
      </section>

      {loading && !data && <Spinner />}
      {error && !data && <ErrorBox message={error.message} onRetry={refresh} />}
      {data && data.shares.length === 0 && <Empty>Nothing is shared yet. Open the Contributions tab and choose entries to share.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.shares.map((s) => (
          <article key={s.shareId} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">The class sees</div>
                <div className="font-bold text-violet-800">{s.publicLabel}</div>
                <div className="text-xs text-slate-500">
                  (Only you can see: {s.groupName} · {s.entry.author.name} {s.entry.author.class}/{s.entry.author.classNo})
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TagBadge tag={s.entry.tag} />
                {!archived && (
                  <button className="btn-ghost btn-sm" onClick={() => unshare(s.shareId)}>
                    Unshare
                  </button>
                )}
              </div>
            </div>
            <EntryBody body={s.entry.body} hasImage={s.entry.hasImage} entryId={s.entry.id} table={s.entry.table} />
            {s.critiques.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Peer critiques ({s.critiques.length})</div>
                <ul className="space-y-2">
                  {s.critiques.map((c) => (
                    <li key={c.id} className={`rounded-lg p-3 text-sm ${c.hidden ? "bg-slate-100 text-slate-400 line-through" : "bg-slate-50"}`}>
                      <div className="mb-0.5 flex items-center justify-between text-xs">
                        <span>
                          <b>{c.promptLabel}</b> · {c.author}
                        </span>
                        <button className="font-semibold text-blue-700 hover:underline" onClick={() => hide(c.id, !c.hidden)}>
                          {c.hidden ? "Show again" : "Hide from class"}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{c.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export function ExportTab({ session }: { session: SessionDetail }) {
  const base = `/api/teacher/sessions/${session.id}/export`;
  const items = [
    { href: `${base}?format=csv&kind=entries`, title: "Student responses (CSV)", sub: "One row per entry: student name, class, class number, tag, stage, group, text, status…" },
    { href: `${base}?format=json`, title: "Everything (JSON)", sub: "Stage labels, guiding questions, entries with tags and tables, and all AI outputs." },
    { href: `${base}?format=csv&kind=ai`, title: "AI outputs (CSV)", sub: "Summaries, comparisons and discussion points with cited entry IDs and publish status." },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((i) => (
        <a key={i.href} href={i.href} className="card block hover:border-blue-400 hover:shadow-md" download>
          <div className="mb-1 text-2xl" aria-hidden>
            ⬇
          </div>
          <div className="font-bold">{i.title}</div>
          <p className="mt-1 text-sm text-slate-600">{i.sub}</p>
        </a>
      ))}
      <p className="text-xs text-slate-500 md:col-span-3">Exports contain original student wording and names. Handle them according to your school’s data policy. Image attachments are flagged but not included in the files.</p>
    </div>
  );
}
