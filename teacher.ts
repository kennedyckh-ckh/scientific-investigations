import { route, bad, forbidden, notFound, HttpError, str, int, partNo, safeLink } from "../router";
import { all, get, run, tx, now, num, audit, type Row } from "../db";
import { requireTeacher, ownSession, ownGroup, mustBeActive, submissionInfo, onlineEditors } from "../authz";
import { createSession, partConfig, setQuestions, activeGroupIds } from "../sessions";
import { entriesWhere, deleteImageFile } from "../entries";
import { publishedShares, publishedAi, critiquePromptsOf } from "../sharing";
import { LIMITS, PART_TITLES, ONLINE_WINDOW_MS, DEFAULT_CRITIQUE_PROMPTS } from "../constants";

/* ---------- Sessions list / create ---------- */
route("GET", "/teacher/sessions", (ctx) => {
  const t = requireTeacher(ctx);
  const rows = all(
    "SELECT s.*, (SELECT COUNT(*) FROM groups g WHERE g.session_id=s.id) AS groups_n, (SELECT COUNT(*) FROM students st WHERE st.session_id=s.id) AS students_n FROM sessions s WHERE s.teacher_id=? ORDER BY s.status, s.created_at DESC",
    t.id
  );
  return {
    sessions: rows.map((s) => ({
      id: num(s.id),
      title: s.title,
      joinCode: s.join_code,
      status: s.status,
      groups: num(s.groups_n),
      students: num(s.students_n),
      fromTemplate: !!s.source_template_id,
      createdAt: num(s.created_at),
    })),
  };
});

route("GET", "/teacher/assigned-templates", (ctx) => {
  const t = requireTeacher(ctx);
  const rows = all(
    "SELECT a.*, tp.title, tp.pedagogy_notes, tp.version, tp.ai_criteria, u.name AS educator_name FROM template_assignments a JOIN templates tp ON tp.id=a.template_id JOIN users u ON u.id=tp.educator_id WHERE a.teacher_id=? ORDER BY a.assigned_at DESC",
    t.id
  );
  return {
    templates: rows.map((r) => ({
      assignmentId: num(r.id),
      templateId: num(r.template_id),
      title: r.title,
      pedagogyNotes: r.pedagogy_notes,
      aiCriteria: r.ai_criteria,
      version: num(r.version),
      note: r.note,
      refLinks: JSON.parse(String(r.ref_links_json)),
      educator: r.educator_name,
      assignedAt: num(r.assigned_at),
      parts: [1, 2, 3].map((p) => ({
        part: p,
        instructions: String(get("SELECT instructions FROM template_parts WHERE template_id=? AND part=?", num(r.template_id), p)?.instructions ?? ""),
        webLink: String(get("SELECT web_link FROM template_parts WHERE template_id=? AND part=?", num(r.template_id), p)?.web_link ?? ""),
        questions: all("SELECT text FROM template_questions WHERE template_id=? AND part=? ORDER BY position", num(r.template_id), p).map((q) => String(q.text)),
      })),
    })),
  };
});

route("POST", "/teacher/sessions", (ctx) => {
  const t = requireTeacher(ctx);
  const title = str(ctx.body?.title, 150, "Session title");
  let templateId: number | undefined;
  if (ctx.body?.assignmentId !== undefined && ctx.body?.assignmentId !== null) {
    // Only templates actually assigned to THIS teacher can be imported.
    const a = get("SELECT template_id FROM template_assignments WHERE id=? AND teacher_id=?", int(ctx.body.assignmentId, "assignmentId"), t.id);
    if (!a) throw forbidden("That template has not been shared with you.");
    templateId = num(a.template_id);
  }
  const id = createSession(t.id, title, templateId);
  audit("staff", t.id, templateId ? "session.create_from_template" : "session.create", `session:${id}`);
  return { id };
});

/* ---------- Session detail / settings ---------- */
function sessionDetail(s: Row) {
  const sid = num(s.id);
  const src = s.source_template_id ? get("SELECT title,version FROM templates WHERE id=?", num(s.source_template_id)) : undefined;
  return {
    id: sid,
    title: s.title,
    joinCode: s.join_code,
    status: s.status,
    anonymiseSharing: !!num(s.anonymise_sharing),
    critiquePrompts: critiquePromptsOf(s),
    aiCriteria: s.ai_criteria,
    pedagogyNotes: s.pedagogy_notes,
    source: s.source_template_id ? { templateId: num(s.source_template_id), title: src?.title ?? "(removed)", importedVersion: num(s.source_version), currentVersion: src ? num(src.version) : null } : null,
    parts: partConfig(sid),
    groups: all("SELECT g.*,(SELECT COUNT(*) FROM students st WHERE st.group_id=g.id) AS n FROM groups g WHERE g.session_id=? ORDER BY g.id", sid).map((g) => ({
      id: num(g.id),
      name: g.name,
      pin: g.pin ?? "",
      seatCap: g.seat_cap === null ? null : num(g.seat_cap),
      members: num(g.n),
    })),
  };
}

route("GET", "/teacher/sessions/:id", (ctx) => sessionDetail(ownSession(ctx, ctx.params.id)));

route("PATCH", "/teacher/sessions/:id", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const b = ctx.body || {};
  const sid = num(s.id);
  if ("title" in b) run("UPDATE sessions SET title=? WHERE id=?", str(b.title, 150, "Session title"), sid);
  if ("anonymiseSharing" in b) run("UPDATE sessions SET anonymise_sharing=? WHERE id=?", b.anonymiseSharing ? 1 : 0, sid);
  if ("aiCriteria" in b) run("UPDATE sessions SET ai_criteria=? WHERE id=?", str(b.aiCriteria, 2000, "AI criteria", { optional: true }), sid);
  if ("critiquePrompts" in b) {
    if (!Array.isArray(b.critiquePrompts)) throw bad("Invalid critique prompts");
    const allowed = new Map(DEFAULT_CRITIQUE_PROMPTS.map((p) => [p.key, p.label]));
    const cur = critiquePromptsOf(s);
    const next = (b.critiquePrompts as { key?: string; label?: string; enabled?: boolean }[]).slice(0, 12).map((p) => {
      const key = str(p.key, 40, "Prompt key");
      const label = allowed.get(key) ?? str(p.label, 120, "Prompt label");
      return { key, label, enabled: !!p.enabled };
    });
    run("UPDATE sessions SET critique_prompts_json=? WHERE id=?", JSON.stringify(next.length ? next : cur), sid);
  }
  audit("staff", ctx.auth.staff!.id, "session.update", `session:${sid}`);
  return sessionDetail(ownSession(ctx, sid));
});

route("PUT", "/teacher/sessions/:id/parts/:n", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const part = partNo(ctx.params.n);
  const b = ctx.body || {};
  const instructions = str(b.instructions, 5000, "Instructions", { optional: true });
  const link = safeLink(b.webLink);
  if (!Array.isArray(b.questions)) throw bad("Guiding questions must be a list");
  const qs = (b.questions as unknown[]).map((q) => str(q, 500, "Guiding question", { optional: true })).filter(Boolean);
  if (qs.length > 20) throw bad("At most 20 guiding questions per part");
  tx(() => {
    run("UPDATE session_parts SET instructions=?, web_link=? WHERE session_id=? AND part=?", instructions, link, num(s.id), part);
    setQuestions(num(s.id), part, qs);
  });
  return { parts: partConfig(num(s.id)) };
});

/* Visibility: hidden | visible (shown but locked) | open. Opening Part 2/3 checks the previous part. */
function missingGroups(sessionId: number, part: number) {
  if (part === 1) return [];
  return activeGroupIds(sessionId)
    .filter((gid) => submissionInfo(gid, part - 1).status !== "submitted")
    .map((gid) => ({ id: gid, name: String(get("SELECT name FROM groups WHERE id=?", gid)!.name), status: submissionInfo(gid, part - 1).status }));
}

route("POST", "/teacher/sessions/:id/parts/:n/visibility", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const part = partNo(ctx.params.n);
  const v = ctx.body?.visibility;
  if (v !== "hidden" && v !== "visible" && v !== "open") throw bad("visibility must be hidden, visible or open");
  const sid = num(s.id);
  if (v === "open" && part > 1) {
    const missing = missingGroups(sid, part);
    if (missing.length) {
      if (ctx.body?.override !== true) throw new HttpError(409, "groups_missing", `${missing.length} active group(s) have not submitted Part ${part - 1}: ${missing.map((m) => m.name).join(", ")}.`);
      const reason = str(ctx.body?.reason, 300, "Reason for override");
      run("INSERT INTO part_overrides(session_id,part,overridden_by,reason,missing_groups_json,at) VALUES(?,?,?,?,?,?)", sid, part, ctx.auth.staff!.id, reason, JSON.stringify(missing), now());
      audit("staff", ctx.auth.staff!.id, "part.override_unlock", `session:${sid}:part:${part}`);
    }
  }
  run("UPDATE session_parts SET visibility=? WHERE session_id=? AND part=?", v, sid, part);
  audit("staff", ctx.auth.staff!.id, `part.${v}`, `session:${sid}:part:${part}`);
  return { parts: partConfig(sid) };
});

/* ---------- Archive / restore / delete ---------- */
route("POST", "/teacher/sessions/:id/archive", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  run("UPDATE sessions SET status='archived', archived_at=? WHERE id=?", now(), num(s.id));
  return { ok: true };
});
route("POST", "/teacher/sessions/:id/restore", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  run("UPDATE sessions SET status='active', archived_at=NULL WHERE id=?", num(s.id));
  return { ok: true };
});
route("DELETE", "/teacher/sessions/:id", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  if (s.status !== "archived") throw forbidden("Archive the session first; only archived sessions can be deleted.", "not_archived");
  if (ctx.body?.confirmTitle !== s.title) throw bad("Type the session title to confirm deletion.", "confirm_required");
  const files = all("SELECT image_file FROM entries WHERE session_id=? AND image_file IS NOT NULL", num(s.id));
  tx(() => run("DELETE FROM sessions WHERE id=?", num(s.id)));
  files.forEach((f) => deleteImageFile(String(f.image_file)));
  audit("staff", ctx.auth.staff!.id, "session.delete", `session:${num(s.id)}`);
  return { ok: true };
});

/* ---------- Groups ---------- */
function groupFields(b: Record<string, unknown>) {
  const name = str(b.name, 60, "Group name");
  const pin = typeof b.pin === "string" ? b.pin.trim() : "";
  if (pin && !/^[A-Za-z0-9]{3,12}$/.test(pin)) throw bad("PIN must be 3 to 12 letters or digits");
  let cap: number | null = null;
  if (b.seatCap !== null && b.seatCap !== undefined && b.seatCap !== "") {
    cap = int(b.seatCap, "Seat cap");
    if (cap < 1 || cap > 60) throw bad("Seat cap must be between 1 and 60");
  }
  return { name, pin: pin || null, cap };
}
route("POST", "/teacher/sessions/:id/groups", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  if (num(get("SELECT COUNT(*) AS n FROM groups WHERE session_id=?", num(s.id))!.n) >= 40) throw bad("At most 40 groups per session");
  const f = groupFields(ctx.body || {});
  const id = run("INSERT INTO groups(session_id,name,pin,seat_cap) VALUES(?,?,?,?)", num(s.id), f.name, f.pin, f.cap).id;
  return { id };
});
route("PATCH", "/teacher/sessions/:id/groups/:gid", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const g = ownGroup(s, ctx.params.gid);
  const f = groupFields({ name: g.name, pin: g.pin ?? "", seatCap: g.seat_cap, ...(ctx.body || {}) });
  const members = num(get("SELECT COUNT(*) AS n FROM students WHERE group_id=?", num(g.id))!.n);
  if (f.cap !== null && f.cap < members) throw bad(`This group already has ${members} members, so the seat cap cannot be lower.`);
  run("UPDATE groups SET name=?, pin=?, seat_cap=? WHERE id=?", f.name, f.pin, f.cap, num(g.id));
  return { ok: true };
});
route("DELETE", "/teacher/sessions/:id/groups/:gid", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const g = ownGroup(s, ctx.params.gid);
  if (num(get("SELECT COUNT(*) AS n FROM students WHERE group_id=?", num(g.id))!.n) > 0) throw new HttpError(409, "group_has_students", "This group has students in it, so it cannot be removed.");
  run("DELETE FROM groups WHERE id=?", num(g.id));
  return { ok: true };
});

/* ---------- Monitoring ---------- */
route("GET", "/teacher/sessions/:id/status", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const sid = num(s.id);
  const groups = all("SELECT * FROM groups WHERE session_id=? ORDER BY id", sid).map((g) => {
    const gid = num(g.id);
    const members = all("SELECT s.id,s.name,s.class,s.class_no,p.last_beat,p.editing_entry_id FROM students s LEFT JOIN presence p ON p.student_id=s.id WHERE s.group_id=? ORDER BY s.name", gid).map((m) => ({
      id: num(m.id),
      name: m.name,
      class: m.class,
      classNo: m.class_no,
      online: !!m.last_beat && now() - num(m.last_beat) < ONLINE_WINDOW_MS,
    }));
    const parts = [1, 2, 3].map((part) => ({
      part,
      submission: submissionInfo(gid, part),
      entryCount: num(get("SELECT COUNT(*) AS n FROM entries WHERE group_id=? AND part=? AND deleted_at IS NULL", gid, part)!.n),
      editing: onlineEditors(gid, part).length,
    }));
    return { id: gid, name: g.name, members, parts };
  });
  const active = groups.filter((g) => g.members.length > 0);
  const summary = [1, 2, 3].map((part) => ({
    part,
    activeGroups: active.length,
    submitted: active.filter((g) => g.parts[part - 1].submission.status === "submitted").length,
    missing: active.filter((g) => g.parts[part - 1].submission.status !== "submitted").map((g) => g.name),
  }));
  const recovery = all("SELECT r.id,r.created_at,s.name,s.class,s.class_no,g.name AS group_name FROM recovery_requests r JOIN students s ON s.id=r.student_id JOIN groups g ON g.id=s.group_id WHERE s.session_id=? AND r.approved_at IS NULL ORDER BY r.id", sid).map((r) => ({ id: num(r.id), name: r.name, class: r.class, classNo: r.class_no, group: r.group_name, createdAt: num(r.created_at) }));
  const overrides = all("SELECT part,reason,at,missing_groups_json FROM part_overrides WHERE session_id=? ORDER BY id DESC", sid).map((o) => ({ part: num(o.part), reason: o.reason, at: num(o.at), missing: JSON.parse(String(o.missing_groups_json)) }));
  return { status: s.status, parts: partConfig(sid).map((p) => ({ part: p.part, title: PART_TITLES[p.part], visibility: p.visibility })), groups, summary, recovery, overrides };
});

route("GET", "/teacher/sessions/:id/entries", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const sid = num(s.id);
  const clauses = ["e.session_id=?"];
  const params: unknown[] = [sid];
  if (ctx.query.get("groupId")) {
    clauses.push("e.group_id=?");
    params.push(num(ownGroup(s, ctx.query.get("groupId")!).id));
  }
  if (ctx.query.get("part")) {
    clauses.push("e.part=?");
    params.push(partNo(ctx.query.get("part")));
  }
  const shared = new Map(all("SELECT id,entry_id FROM shares WHERE session_id=?", sid).map((r) => [num(r.entry_id), num(r.id)]));
  const groups = new Map(all("SELECT id,name FROM groups WHERE session_id=?", sid).map((g) => [num(g.id), String(g.name)]));
  return {
    entries: entriesWhere(clauses.join(" AND "), ...params).map((e) => ({ ...e, groupName: groups.get(e.groupId), shared: shared.has(e.id), shareId: shared.get(e.id) ?? null })),
  };
});

route("POST", "/teacher/sessions/:id/unlock-submission", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const g = ownGroup(s, ctx.body?.groupId);
  const part = partNo(ctx.body?.part);
  const info = submissionInfo(num(g.id), part);
  if (info.status !== "submitted") throw new HttpError(409, "not_submitted", "That group has no locked submission for this part.");
  run("UPDATE part_submissions SET unlocked_at=?, unlocked_by=? WHERE group_id=? AND part=? AND revision=?", now(), ctx.auth.staff!.id, num(g.id), part, info.revision);
  audit("staff", ctx.auth.staff!.id, "submission.unlock", `group:${num(g.id)}:part:${part}`);
  return { ok: true };
});

route("POST", "/teacher/sessions/:id/recovery/:rid/approve", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const r = get("SELECT r.id FROM recovery_requests r JOIN students st ON st.id=r.student_id WHERE r.id=? AND st.session_id=?", Number(ctx.params.rid), num(s.id));
  if (!r) throw notFound();
  run("UPDATE recovery_requests SET approved_at=? WHERE id=?", now(), num(r.id));
  return { ok: true };
});

/* ---------- Sharing with the class ---------- */
route("GET", "/teacher/sessions/:id/shares", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const sid = num(s.id);
  const prompts = critiquePromptsOf(s);
  const rows = all("SELECT * FROM shares WHERE session_id=? ORDER BY seq", sid).map((sh) => {
    const e = entriesWhere("e.id=?", num(sh.entry_id))[0];
    if (!e) return null;
    const group = String(get("SELECT name FROM groups WHERE id=?", e.groupId)!.name);
    const critiques = all("SELECT * FROM critiques WHERE share_id=? ORDER BY id", num(sh.id)).map((c) => {
      const st = get("SELECT name,class,class_no FROM students WHERE id=?", num(c.student_id))!;
      return { id: num(c.id), promptLabel: prompts.find((p) => p.key === c.prompt_key)?.label || String(c.prompt_key), body: c.body, hidden: !!num(c.hidden), author: `${st.name} (${st.class}/${st.class_no})` };
    });
    return { shareId: num(sh.id), seq: num(sh.seq), publishedAt: num(sh.published_at), entry: e, groupName: group, publicLabel: num(s.anonymise_sharing) ? `Sample Response #${num(sh.seq)}` : group, critiques };
  });
  return { shares: rows.filter(Boolean), anonymised: !!num(s.anonymise_sharing) };
});

route("POST", "/teacher/sessions/:id/shares", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  mustBeActive(s);
  const ids = ctx.body?.entryIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw bad("Choose between 1 and 100 entries to share");
  const sid = num(s.id);
  return tx(() => {
    let added = 0;
    for (const raw of ids) {
      const eid = int(raw, "entry id");
      // Only ORIGINAL student entries from THIS session can be shared.
      const e = get("SELECT id FROM entries WHERE id=? AND session_id=? AND deleted_at IS NULL", eid, sid);
      if (!e) throw notFound(`Entry ${eid} not found in this session`);
      if (get("SELECT 1 FROM shares WHERE session_id=? AND entry_id=?", sid, eid)) continue;
      const seq = num(get("SELECT COALESCE(MAX(seq),0)+1 AS n FROM shares WHERE session_id=?", sid)!.n);
      run("INSERT INTO shares(session_id,entry_id,seq,published_at) VALUES(?,?,?,?)", sid, eid, seq, now());
      added++;
    }
    audit("staff", ctx.auth.staff!.id, "share.publish", `session:${sid}:n=${added}`);
    return { added };
  });
});

route("DELETE", "/teacher/sessions/:id/shares/:shareId", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const r = run("DELETE FROM shares WHERE id=? AND session_id=?", Number(ctx.params.shareId), num(s.id));
  if (!r.changes) throw notFound();
  return { ok: true };
});

route("POST", "/teacher/sessions/:id/critiques/:cid/hide", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const c = get("SELECT c.id FROM critiques c JOIN shares sh ON sh.id=c.share_id WHERE c.id=? AND sh.session_id=?", Number(ctx.params.cid), num(s.id));
  if (!c) throw notFound();
  run("UPDATE critiques SET hidden=? WHERE id=?", ctx.body?.hidden === false ? 0 : 1, num(c.id));
  return { ok: true };
});

/* Projector view: exactly what is published, nothing else. */
route("GET", "/teacher/sessions/:id/projector", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  return { title: s.title, anonymised: !!num(s.anonymise_sharing), shares: publishedShares(s), ai: publishedAi(num(s.id)) };
});

/* ---------- Export ---------- */
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula-injection guard
  return `"${s.replace(/"/g, '""')}"`;
};
const csv = (head: string[], rows: unknown[][]) => [head.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");

route("GET", "/teacher/sessions/:id/export", (ctx) => {
  const s = ownSession(ctx, ctx.params.id);
  const sid = num(s.id);
  const fmt = ctx.query.get("format") === "csv" ? "csv" : "json";
  const kind = ctx.query.get("kind") === "ai" ? "ai" : "entries";
  const parts = partConfig(sid);
  const groups = new Map(all("SELECT id,name FROM groups WHERE session_id=?", sid).map((g) => [num(g.id), String(g.name)]));
  const sharedIds = new Set(all("SELECT entry_id FROM shares WHERE session_id=?", sid).map((r) => num(r.entry_id)));
  const entries = entriesWhere("e.session_id=?", sid).map((e) => {
    const sub = submissionInfo(e.groupId, e.part);
    return {
      entryId: e.id,
      stage: PART_TITLES[e.part],
      part: e.part,
      group: groups.get(e.groupId) || "",
      studentName: e.author.name,
      studentClass: e.author.class,
      studentClassNo: e.author.classNo,
      tag: e.tag || "",
      text: e.body,
      table: e.table,
      hasImage: e.hasImage,
      groupSubmissionStatus: sub.status,
      sharedWithClass: sharedIds.has(e.id),
      createdAt: new Date(e.createdAt).toISOString(),
      updatedAt: new Date(e.updatedAt).toISOString(),
    };
  });
  const ai = all("SELECT * FROM ai_outputs WHERE session_id=? ORDER BY id", sid).map((o) => ({
    id: num(o.id),
    kind: o.kind,
    part: num(o.part),
    group: o.group_id ? groups.get(num(o.group_id)) || "" : "",
    status: o.status,
    provider: o.provider,
    criteria: o.criteria,
    citedEntryIds: JSON.parse(String(o.cited_ids_json)),
    content: JSON.parse(String(o.content_json)),
    createdAt: new Date(num(o.created_at)).toISOString(),
  }));
  const fname = `${String(s.title).replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}_${kind}`;
  let payload: string;
  let type: string;
  if (fmt === "json") {
    payload = JSON.stringify(
      { session: { id: sid, title: s.title, exportedAt: new Date().toISOString() }, stages: parts.map((p) => ({ part: p.part, label: PART_TITLES[p.part], instructions: p.instructions, webLink: p.webLink, guidingQuestions: p.questions.map((q) => q.text) })), entries, aiOutputs: ai },
      null,
      2
    );
    type = "application/json";
  } else if (kind === "entries") {
    const q = (n: number) => parts[n - 1].questions.map((x) => x.text).join(" | ");
    payload = csv(
      ["entry_id", "stage", "group", "student_name", "class", "class_no", "tag", "text", "data_table", "has_image", "group_submission_status", "shared_with_class", "guiding_questions_for_stage", "created_at", "updated_at"],
      entries.map((e) => [e.entryId, e.stage, e.group, e.studentName, e.studentClass, e.studentClassNo, e.tag, e.text, e.table ? JSON.stringify(e.table) : "", e.hasImage ? "yes" : "no", e.groupSubmissionStatus, e.sharedWithClass ? "yes" : "no", q(e.part), e.createdAt, e.updatedAt])
    );
    type = "text/csv; charset=utf-8";
  } else {
    payload = csv(
      ["id", "kind", "stage", "group", "status", "provider", "criteria", "cited_entry_ids", "content", "created_at"],
      ai.map((o) => [o.id, o.kind, PART_TITLES[o.part], o.group, o.status, o.provider, o.criteria, o.citedEntryIds.join(" "), JSON.stringify(o.content), o.createdAt])
    );
    type = "text/csv; charset=utf-8";
  }
  audit("staff", ctx.auth.staff!.id, "export", `session:${sid}:${fmt}:${kind}`);
  return new Response("﻿" + payload, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${fname}.${fmt}"` } });
});

void LIMITS;
