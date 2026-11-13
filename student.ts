import { route, bad, forbidden, notFound, HttpError, str, partNo, int, type Ctx } from "../router";
import { all, get, run, tx, now, num } from "../db";
import {
  requireStudent,
  assertStudentCanRead,
  assertStudentCanEdit,
  submissionInfo,
  partVisibility,
  onlineEditors,
} from "../authz";
import { entriesWhere, validateTag, validateTable, saveImage, deleteImageFile, readImage } from "../entries";
import { questionsFor } from "../sessions";
import { publishedShares, publishedAi, critiquePromptsOf } from "../sharing";
import { LIMITS, PART_TITLES, ONLINE_WINDOW_MS } from "../constants";

route("GET", "/student/state", (ctx) => {
  const sc = requireStudent(ctx, { allowArchived: true });
  const sid = num(sc.session.id);
  const gid = num(sc.group.id);
  const parts = [1, 2, 3]
    .map((part) => {
      const p = get("SELECT * FROM session_parts WHERE session_id=? AND part=?", sid, part)!;
      const vis = String(p.visibility);
      if (vis === "hidden") return null;
      const base = { part, title: PART_TITLES[part], locked: vis !== "open" };
      if (vis !== "open") return base;
      return {
        ...base,
        instructions: String(p.instructions),
        webLink: String(p.web_link),
        questions: questionsFor(sid, part),
        submission: submissionInfo(gid, part),
        entryCount: num(get("SELECT COUNT(*) AS n FROM entries WHERE group_id=? AND part=? AND deleted_at IS NULL", gid, part)!.n),
      };
    })
    .filter((x) => x !== null);
  const members = all("SELECT s.id,s.name,s.class,s.class_no,p.last_beat FROM students s LEFT JOIN presence p ON p.student_id=s.id WHERE s.group_id=? ORDER BY s.name", gid).map((m) => ({
    id: num(m.id),
    name: m.name,
    class: m.class,
    classNo: m.class_no,
    me: num(m.id) === num(sc.student.id),
    online: !!m.last_beat && now() - num(m.last_beat) < ONLINE_WINDOW_MS,
  }));
  return {
    student: { id: num(sc.student.id), name: sc.student.name, class: sc.student.class, classNo: sc.student.class_no },
    session: { title: sc.session.title, archived: sc.session.status !== "active" },
    group: { id: gid, name: sc.group.name, members },
    parts,
    serverTime: now(),
  };
});

route("GET", "/student/entries", (ctx) => {
  const sc = requireStudent(ctx);
  const part = partNo(ctx.query.get("part"));
  assertStudentCanRead(sc, part);
  const entries = entriesWhere("e.group_id=? AND e.part=?", num(sc.group.id), part).map((e) => ({ ...e, mine: e.studentId === num(sc.student.id) }));
  const editing = onlineEditors(num(sc.group.id), part, num(sc.student.id)).map((r) => ({ studentId: num(r.student_id), name: r.name, entryId: num(r.editing_entry_id) }));
  return { entries, editing, submission: submissionInfo(num(sc.group.id), part) };
});

function bodyText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw bad("Entry text must be text");
  if (v.length > LIMITS.bodyMax) throw bad(`Entry text is too long (max ${LIMITS.bodyMax} characters)`);
  return v;
}

route("POST", "/student/entries", (ctx) => {
  const sc = requireStudent(ctx);
  const b = ctx.body || {};
  const part = partNo(b.part);
  assertStudentCanEdit(sc, part);
  const tag = validateTag(b.tag);
  const body = bodyText(b.body);
  const table = validateTable(b.table);
  const image = b.image ? saveImage(b.image) : null;
  const t = now();
  const id = run(
    "INSERT INTO entries(session_id,group_id,part,student_id,tag,body,image_file,table_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    num(sc.session.id),
    num(sc.group.id),
    part,
    num(sc.student.id),
    tag,
    body,
    image,
    table ? JSON.stringify(table) : null,
    t,
    t
  ).id;
  return { entry: entriesWhere("e.id=?", id).map((e) => ({ ...e, mine: true }))[0] };
});

function ownEntry(ctx: Ctx, sc: ReturnType<typeof requireStudent>) {
  const e = get("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL", Number(ctx.params.id));
  // Another group's entry is reported as not found. A teammate's entry is read-only.
  if (!e || num(e.group_id) !== num(sc.group.id)) throw notFound("Entry not found");
  if (num(e.student_id) !== num(sc.student.id)) throw forbidden("You can only change your own entries. Add your own entry instead.", "not_your_entry");
  return e;
}

route("PATCH", "/student/entries/:id", (ctx) => {
  const sc = requireStudent(ctx);
  const e = ownEntry(ctx, sc);
  assertStudentCanEdit(sc, num(e.part));
  const b = ctx.body || {};
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("tag" in b) {
    sets.push("tag=?");
    vals.push(validateTag(b.tag));
  }
  if ("body" in b) {
    sets.push("body=?");
    vals.push(bodyText(b.body));
  }
  if ("table" in b) {
    const t = validateTable(b.table);
    sets.push("table_json=?");
    vals.push(t ? JSON.stringify(t) : null);
  }
  let oldImage: string | null = null;
  if ("image" in b) {
    oldImage = e.image_file ? String(e.image_file) : null;
    sets.push("image_file=?");
    vals.push(b.image ? saveImage(b.image) : null);
  }
  if (!sets.length) return { entry: entriesWhere("e.id=?", num(e.id)).map((x) => ({ ...x, mine: true }))[0] };
  // Optimistic guard: if the client's copy is older than the server's, tell it instead of silently overwriting.
  if (typeof b.baseUpdatedAt === "number" && b.baseUpdatedAt < num(e.updated_at) && b.force !== true)
    throw new HttpError(409, "stale", "This entry was changed on another device. Reload it before saving.");
  run(`UPDATE entries SET ${sets.join(",")}, updated_at=? WHERE id=?`, ...vals, now(), num(e.id));
  if (oldImage) deleteImageFile(oldImage);
  return { entry: entriesWhere("e.id=?", num(e.id)).map((x) => ({ ...x, mine: true }))[0] };
});

route("DELETE", "/student/entries/:id", (ctx) => {
  const sc = requireStudent(ctx);
  const e = ownEntry(ctx, sc);
  assertStudentCanEdit(sc, num(e.part));
  // Soft delete: submitted snapshots and AI citations stay valid.
  run("UPDATE entries SET deleted_at=?, updated_at=? WHERE id=?", now(), now(), num(e.id));
  run("DELETE FROM shares WHERE entry_id=?", num(e.id));
  return { ok: true };
});

route("POST", "/student/presence", (ctx) => {
  const sc = requireStudent(ctx);
  const b = ctx.body || {};
  const part = partNo(b.part);
  if (partVisibility(num(sc.session.id), part) !== "open") throw forbidden("This part is locked.", "part_locked");
  const editing = b.editingEntryId === null || b.editingEntryId === undefined ? null : int(b.editingEntryId, "editingEntryId");
  run(
    "INSERT INTO presence(student_id,group_id,part,editing_entry_id,last_beat) VALUES(?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET part=excluded.part, editing_entry_id=excluded.editing_entry_id, last_beat=excluded.last_beat",
    num(sc.student.id),
    num(sc.group.id),
    part,
    editing,
    now()
  );
  return { ok: true };
});

route("GET", "/student/submit-check", (ctx) => {
  const sc = requireStudent(ctx);
  const part = partNo(ctx.query.get("part"));
  assertStudentCanRead(sc, part);
  const entries = entriesWhere("e.group_id=? AND e.part=?", num(sc.group.id), part);
  const members = all("SELECT id,name,class,class_no FROM students WHERE group_id=? ORDER BY name", num(sc.group.id)).map((m) => ({
    id: num(m.id),
    name: String(m.name),
    class: String(m.class),
    classNo: String(m.class_no),
    entries: entries.filter((e) => e.studentId === num(m.id)),
  }));
  const editors = onlineEditors(num(sc.group.id), part, num(sc.student.id)).map((r) => ({ studentId: num(r.student_id), name: String(r.name), class: String(r.class), classNo: String(r.class_no) }));
  return { members, editors, entryCount: entries.length, submission: submissionInfo(num(sc.group.id), part) };
});

route("POST", "/student/submit", (ctx) => {
  const sc = requireStudent(ctx);
  const b = ctx.body || {};
  const part = partNo(b.part);
  if (b.confirm !== true) throw bad("Please confirm the submission", "confirm_required");
  assertStudentCanEdit(sc, part);
  const gid = num(sc.group.id);
  return tx(() => {
    const entries = entriesWhere("e.group_id=? AND e.part=?", gid, part);
    if (!entries.length) throw bad("Add at least one entry before submitting.", "nothing_to_submit");
    const editors = onlineEditors(gid, part, num(sc.student.id));
    if (editors.length && b.acknowledgeEditors !== true)
      throw new HttpError(409, "editors_active", `${editors.map((e) => String(e.name)).join(", ")} may have unsaved work.`);
    const rev = submissionInfo(gid, part).revision + 1;
    run(
      "INSERT INTO part_submissions(group_id,part,revision,submitted_by,submitted_at,snapshot_json) VALUES(?,?,?,?,?,?)",
      gid,
      part,
      rev,
      num(sc.student.id),
      now(),
      JSON.stringify(entries)
    );
    return { submission: submissionInfo(gid, part) };
  });
});

route("GET", "/student/reference", (ctx) => {
  const sc = requireStudent(ctx);
  const part = partNo(ctx.query.get("part"));
  assertStudentCanRead(sc, part);
  if (part === 1) return { parts: [] };
  const gid = num(sc.group.id);
  const earlier = part === 2 ? [1] : [1, 2];
  return {
    parts: earlier.map((p) => {
      const sub = get("SELECT revision,submitted_at,snapshot_json FROM part_submissions WHERE group_id=? AND part=? ORDER BY revision DESC LIMIT 1", gid, p);
      return sub
        ? { part: p, title: PART_TITLES[p], submitted: true, revision: num(sub.revision), submittedAt: num(sub.submitted_at), entries: JSON.parse(String(sub.snapshot_json)) }
        : { part: p, title: PART_TITLES[p], submitted: false, entries: [] };
    }),
  };
});

route("GET", "/student/class", (ctx) => {
  const sc = requireStudent(ctx);
  const prompts = critiquePromptsOf(sc.session).filter((p) => p.enabled);
  return {
    anonymised: !!num(sc.session.anonymise_sharing),
    shares: publishedShares(sc.session, num(sc.student.id)),
    ai: publishedAi(num(sc.session.id)),
    prompts,
  };
});

route("POST", "/student/critiques", (ctx) => {
  const sc = requireStudent(ctx);
  const b = ctx.body || {};
  const shareId = int(b.shareId, "shareId");
  const share = get("SELECT * FROM shares WHERE id=? AND session_id=?", shareId, num(sc.session.id));
  if (!share) throw notFound("That response is not shared with your class.");
  const prompt = critiquePromptsOf(sc.session).find((p) => p.enabled && p.key === b.promptKey);
  if (!prompt) throw bad("That critique type is not enabled.");
  const body = str(b.body, LIMITS.critiqueMax, "Your critique");
  const n = num(get("SELECT COUNT(*) AS n FROM critiques WHERE share_id=? AND student_id=?", shareId, num(sc.student.id))!.n);
  if (n >= 5) throw bad("You have added the maximum number of critiques to this response.");
  const id = run("INSERT INTO critiques(share_id,student_id,prompt_key,body,created_at) VALUES(?,?,?,?,?)", shareId, num(sc.student.id), prompt.key, body, now()).id;
  return { id };
});

route("DELETE", "/student/critiques/:id", (ctx) => {
  const sc = requireStudent(ctx);
  const c = get("SELECT c.id FROM critiques c JOIN shares s ON s.id=c.share_id WHERE c.id=? AND c.student_id=? AND s.session_id=?", Number(ctx.params.id), num(sc.student.id), num(sc.session.id));
  if (!c) throw notFound();
  run("DELETE FROM critiques WHERE id=?", num(c.id));
  return { ok: true };
});

/* Images are served only through this permission-checked route. */
route("GET", "/images/:id", (ctx) => {
  const e = get("SELECT e.*, s.teacher_id FROM entries e JOIN sessions s ON s.id=e.session_id WHERE e.id=? AND e.deleted_at IS NULL", Number(ctx.params.id));
  if (!e || !e.image_file) throw notFound();
  let allowed = false;
  if (ctx.auth.staff?.role === "teacher" && num(e.teacher_id) === ctx.auth.staff.id) allowed = true;
  if (!allowed && ctx.auth.studentId) {
    const st = get("SELECT session_id,group_id FROM students WHERE id=?", ctx.auth.studentId);
    if (st && num(st.group_id) === num(e.group_id)) allowed = true;
    else if (st && num(st.session_id) === num(e.session_id) && get("SELECT 1 FROM shares WHERE entry_id=?", num(e.id))) allowed = true;
  }
  if (!allowed) throw notFound();
  const img = readImage(String(e.image_file));
  if (!img) throw notFound();
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=60", "Content-Disposition": "inline" } });
});
