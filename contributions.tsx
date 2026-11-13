"use client";
import { useEffect, useState } from "react";
import { api, usePoll, fmtTime, ApiError } from "@/lib/client/api";
import { EntryBody, TagBadge, Spinner, ErrorBox, Empty, useToast } from "@/components/ui";
import { PART_TITLES } from "@/lib/constants";
import type { SessionDetail, TEntry } from "./types";

type E = TEntry & { shareId: number | null };

export function Contributions({ session, focus }: { session: SessionDetail; focus: { groupId: number; part: number } | null }) {
  const toast = useToast();
  const [groupId, setGroupId] = useState<string>(focus ? String(focus.groupId) : "");
  const [part, setPart] = useState<string>(focus ? String(focus.part) : "");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  useEffect(() => {
    if (focus) {
      setGroupId(String(focus.groupId));
      setPart(String(focus.part));
    }
  }, [focus]);
  const qs = new URLSearchParams();
  if (groupId) qs.set("groupId", groupId);
  if (part) qs.set("part", part);
  const { data, error, loading, refresh } = usePoll<{ entries: E[] }>(`/teacher/sessions/${session.id}/entries?${qs}`, 6000);
  const archived = session.status === "archived";

  const entries = (data?.entries ?? []).filter((e) => !tagFilter || e.tag === tagFilter);
  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function share(ids: number[]) {
    setBusy(true);
    try {
      const r = await api<{ added: number }>("POST", `/teacher/sessions/${session.id}/shares`, { entryIds: ids });
      toast(r.added ? `${r.added} entr${r.added === 1 ? "y" : "ies"} shared with the class` : "Already shared");
      setSel(new Set());
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    } finally {
      setBusy(false);
    }
  }
  async function unshare(shareId: number) {
    try {
      await api("DELETE", `/teacher/sessions/${session.id}/shares/${shareId}`);
      toast("Removed from the class board");
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="label">Group</span>
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {session.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Stage</span>
          <select className="input" value={part} onChange={(e) => setPart(e.target.value)}>
            <option value="">All parts</option>
            {[1, 2, 3].map((p) => (
              <option key={p} value={p}>
                {PART_TITLES[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Tag</span>
          <select className="input" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">Any tag</option>
            {Array.from(new Set((data?.entries ?? []).map((e) => e.tag).filter(Boolean))).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        <button className="btn-accent" disabled={busy || archived || sel.size === 0} onClick={() => share(Array.from(sel))}>
          Share {sel.size || ""} selected with class
        </button>
      </div>
      <p className="text-xs text-slate-500">You always see the original student wording with names. Choose which entries to share; the Sharing tab controls whether the class sees group names or anonymous labels.</p>

      {loading && !data && <Spinner />}
      {error && !data && <ErrorBox message={error.message} onRetry={refresh} />}
      {data && entries.length === 0 && <Empty>No entries match these filters yet.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">
        {entries.map((e) => (
          <article key={e.id} className={`card ${sel.has(e.id) ? "ring-2 ring-violet-400" : ""}`}>
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div className="text-xs text-slate-600">
                <div>
                  <b className="text-sm text-slate-900">{e.author.name}</b> · {e.author.class} · No. {e.author.classNo}
                </div>
                <div>
                  {e.groupName} · Part {e.part} · {fmtTime(e.updatedAt)} · <span className="font-mono">E{e.id}</span>
                </div>
              </div>
              <TagBadge tag={e.tag} />
            </div>
            <EntryBody body={e.body} hasImage={e.hasImage} entryId={e.id} table={e.table} />
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sel.has(e.id)} disabled={e.shared || archived} onChange={() => toggle(e.id)} />
                Select
              </label>
              {e.shared && e.shareId ? (
                <span className="flex items-center gap-2">
                  <span className="badge bg-violet-100 text-violet-800">Shared with class</span>
                  {!archived && (
                    <button className="btn-ghost btn-sm" onClick={() => unshare(e.shareId!)}>
                      Unshare
                    </button>
                  )}
                </span>
              ) : (
                <button className="btn-ghost btn-sm" disabled={busy || archived} onClick={() => share([e.id])}>
                  Share with class
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
