import { route, bad, forbidden, notFound, HttpError, str, partNo, int } from "../router";
import { all, get, run, now, num, audit, type Row } from "../db";
import { ownSession, ownGroup, mustBeActive } from "../authz";
import { entriesWhere } from "../entries";
import { getProvider, validateContent, AiError, type AiEntry, type AiKind } from "../ai";

const KINDS: AiKind[] = ["group_summary", "cross_group", "discussion_points"];

/** Teacher-only: AI drafts are never visible to students until published/revealed. */
function dto(o: Row, groups: Map<number, string>) {
  return {
    id: num(o.id),
    kind: String(o.kind),
    part: num(o.part),
    groupId: o.group_id === null ? null : num(o.group_id),
    groupName: o.group_id === null ? null : groups.get(num(o.group_id)) ?? "",
    criteria: String(o.criteria),
    provider: String(o.provider),
    status: String(o.status),
    content: JSON.parse(String(o.content_json)),
    citedIds: JSON.parse(String(o.cited_ids_json)),
    createdAt: num(o.created_at),
    updatedAt: num(o.updated_at),
    publishedAt: o.published_at === null ? null : num(o.published_at),
  };
}
const groupMap = (sid: number) => new Map(all("SELECT id,name FROM groups WHERE session_id=?", sid).map((g) => [num(g.id), String(g.name)]));

route("GET", "/teacher/sessions/:id/ai", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const g = groupMap(num(s.id));
  return { outputs: all("SELECT * FROM ai_outputs WHERE session_id=? ORDER BY id DESC", num(s.id)).map((o) => dto(o, g)) };
});

route("POST", "/teacher/sessions/:id/ai/generate", async (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const sid = num(s.id);
  const b = ctx.body || {};
  const kind = b.kind as AiKind;
  if (!KINDS.includes(kind)) throw bad("kind must be group_summary, cross_group or discussion_points");
  const part = partNo(b.part);
  const criteria = str(b.criteria ?? s.ai_criteria, 2000, "Criteria", { optional: true });
  let groupId: number | null = null;
  const clauses = ["e.session_id=?", "e.part=?"];
  const params: unknown[] = [sid, part];
  if (kind === "group_summary") {
    groupId = num(ownGroup(s, b.groupId).id);
    clauses.push("e.group_id=?");
    params.push(groupId);
  }
  // Original student entries only, with neutral labels: no student names ever reach the AI.
  const rows = entriesWhere(clauses.join(" AND "), ...params);
  if (!rows.length) throw bad("There are no student entries for that selection yet.", "no_entries");
  if (rows.length > 300) throw bad("Too many entries for one analysis (max 300).");
  const groupOrder = all("SELECT id FROM groups WHERE session_id=? ORDER BY id", sid).map((g) => num(g.id));
  const studentLetters = new Map<string, string>();
  const entries: AiEntry[] = rows.map((e) => {
    const key = `${e.groupId}:${e.studentId}`;
    if (!studentLetters.has(key)) studentLetters.set(key, `Student ${String.fromCharCode(65 + (Array.from(studentLetters.keys()).filter((k) => k.startsWith(`${e.groupId}:`)).length % 26))}`);
    return {
      id: e.id,
      group: `Group ${groupOrder.indexOf(e.groupId) + 1}`,
      student: studentLetters.get(key)!,
      part: e.part,
      tag: e.tag,
      text: e.body,
      table: e.table ? [e.table.columns.join(" | "), ...e.table.rows.map((r) => r.join(" | "))].join("; ") : "",
      hasImage: e.hasImage,
    };
  });
  const provider = getProvider();
  let content, cited;
  try {
    const out = await provider.generate({ kind, part, criteria, groupLabel: groupId !== null ? entries[0].group : undefined, entries });
    ({ content, cited } = validateContent(out, new Set(entries.map((e) => e.id)), { requireQuestions: kind === "discussion_points" }));
  } catch (e) {
    if (e instanceof AiError) throw new HttpError(e.code === "ai_not_configured" ? 501 : 502, e.code, e.message);
    throw e;
  }
  const id = run(
    "INSERT INTO ai_outputs(session_id,kind,group_id,part,criteria,provider,content_json,cited_ids_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    sid,
    kind,
    groupId,
    part,
    criteria,
    provider.name,
    JSON.stringify(content),
    JSON.stringify(cited),
    "draft",
    now(),
    now()
  ).id;
  audit("staff", ctx.auth.staff!.id, "ai.generate", `session:${sid}:${kind}`);
  return { id };
});

function ownOutput(ctx: Parameters<typeof ownSession>[0], rawId: string) {
  const s = ownSession(ctx, ctx.params.id);
  const o = get("SELECT * FROM ai_outputs WHERE id=? AND session_id=?", Number(rawId), num(s.id));
  if (!o) throw notFound("AI output not found");
  return { s, o };
}

/* Teacher edits a draft. Edited text must still cite real entries of this session. */
route("PATCH", "/teacher/sessions/:id/ai/:oid", (ctx) => {
  const { s, o } = ownOutput(ctx, ctx.params.oid);
  mustBeActive(s);
  if (o.status === "published" || o.status === "revealed") throw new HttpError(409, "already_published", "Unpublish it before editing, so students never see half-edited text.");
  const allowed = new Set(all("SELECT id FROM entries WHERE session_id=?", num(s.id)).map((r) => num(r.id)));
  let content, cited;
  try {
    ({ content, cited } = validateContent(ctx.body?.content, allowed, { requireQuestions: o.kind === "discussion_points" }));
  } catch (e) {
    if (e instanceof AiError) throw bad(e.message, e.code);
    throw e;
  }
  run("UPDATE ai_outputs SET content_json=?, cited_ids_json=?, status='edited', updated_at=? WHERE id=?", JSON.stringify(content), JSON.stringify(cited), now(), num(o.id));
  return { ok: true };
});

/* Separate controls: summaries are PUBLISHED, discussion points are REVEALED. */
route("POST", "/teacher/sessions/:id/ai/:oid/publish", (ctx) => {
  const { s, o } = ownOutput(ctx, ctx.params.oid);
  mustBeActive(s);
  if (o.kind === "discussion_points") throw bad("Discussion points are revealed, not published. Use Reveal.", "wrong_action");
  if (ctx.body?.reviewed !== true) throw bad("Please confirm you have reviewed this draft.", "review_required");
  run("UPDATE ai_outputs SET status='published', published_at=?, updated_at=? WHERE id=?", now(), now(), num(o.id));
  audit("staff", ctx.auth.staff!.id, "ai.publish", `ai:${num(o.id)}`);
  return { ok: true };
});
route("POST", "/teacher/sessions/:id/ai/:oid/reveal", (ctx) => {
  const { s, o } = ownOutput(ctx, ctx.params.oid);
  mustBeActive(s);
  if (o.kind !== "discussion_points") throw bad("Only discussion points are revealed. Use Publish for summaries.", "wrong_action");
  if (ctx.body?.reviewed !== true) throw bad("Please confirm you have reviewed these questions.", "review_required");
  run("UPDATE ai_outputs SET status='revealed', published_at=?, updated_at=? WHERE id=?", now(), now(), num(o.id));
  audit("staff", ctx.auth.staff!.id, "ai.reveal", `ai:${num(o.id)}`);
  return { ok: true };
});
route("POST", "/teacher/sessions/:id/ai/:oid/unpublish", (ctx) => {
  const { o } = ownOutput(ctx, ctx.params.oid);
  run("UPDATE ai_outputs SET status='edited', published_at=NULL, updated_at=? WHERE id=?", now(), num(o.id));
  return { ok: true };
});
route("DELETE", "/teacher/sessions/:id/ai/:oid", (ctx) => {
  const { o } = ownOutput(ctx, ctx.params.oid);
  if (o.status === "published" || o.status === "revealed") throw forbidden("Unpublish it first.", "already_published");
  run("DELETE FROM ai_outputs WHERE id=?", num(o.id));
  return { ok: true };
});

void int;
