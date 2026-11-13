import { get, all, now, num, run, type Row } from "./db";
import { forbidden, notFound, HttpError, type Ctx } from "./router";
import type { StaffUser } from "./auth";
import { ONLINE_WINDOW_MS } from "./constants";

export function requireTeacher(ctx: Ctx): StaffUser {
  const u = ctx.auth.staff;
  if (!u) throw new HttpError(401, "unauthenticated", "Please sign in.");
  if (u.role !== "teacher") throw forbidden("Teacher account required.");
  return u;
}
export function requireEducator(ctx: Ctx): StaffUser {
  const u = ctx.auth.staff;
  if (!u) throw new HttpError(401, "unauthenticated", "Please sign in.");
  if (u.role !== "educator") throw forbidden("Teacher Educator account required.");
  return u;
}

/** Session owned by this teacher. Anything else is reported as not found (no existence leak). */
export function ownSession(ctx: Ctx, rawId: string | number): Row {
  const t = requireTeacher(ctx);
  const id = Number(rawId);
  const s = Number.isInteger(id) ? get("SELECT * FROM sessions WHERE id=? AND teacher_id=?", id, t.id) : undefined;
  if (!s) throw notFound("Session not found");
  return s;
}
export function ownGroup(session: Row, rawId: string | number): Row {
  const g = get("SELECT * FROM groups WHERE id=? AND session_id=?", Number(rawId), num(session.id));
  if (!g) throw notFound("Group not found");
  return g;
}
/** Teacher may only touch live-state when the session is active. */
export function mustBeActive(session: Row) {
  if (session.status !== "active") throw forbidden("This session is archived. Restore it to make changes.", "session_archived");
}

export interface StudentCtx {
  student: Row;
  session: Row;
  group: Row;
}
export function requireStudent(ctx: Ctx, opts: { allowArchived?: boolean } = {}): StudentCtx {
  if (!ctx.auth.studentId) throw new HttpError(401, "unauthenticated", "Please join your session again.");
  const student = get("SELECT * FROM students WHERE id=?", ctx.auth.studentId);
  if (!student) throw new HttpError(401, "unauthenticated", "Please join your session again.");
  const session = get("SELECT * FROM sessions WHERE id=?", num(student.session_id))!;
  const group = get("SELECT * FROM groups WHERE id=?", num(student.group_id))!;
  if (!opts.allowArchived && session.status !== "active") throw forbidden("This session has been archived by your teacher.", "session_archived");
  if (now() - num(student.last_seen) > 20000) run("UPDATE students SET last_seen=? WHERE id=?", now(), num(student.id));
  return { student, session, group };
}

export function partVisibility(sessionId: number, part: number): "hidden" | "visible" | "open" {
  const r = get("SELECT visibility FROM session_parts WHERE session_id=? AND part=?", sessionId, part);
  return (r?.visibility as "hidden" | "visible" | "open") || "hidden";
}

export type SubStatus = "draft" | "submitted" | "revising";
export interface SubInfo {
  status: SubStatus;
  revision: number;
  submittedAt: number | null;
}
export function submissionInfo(groupId: number, part: number): SubInfo {
  const r = get("SELECT revision,submitted_at,unlocked_at FROM part_submissions WHERE group_id=? AND part=? ORDER BY revision DESC LIMIT 1", groupId, part);
  if (!r) return { status: "draft", revision: 0, submittedAt: null };
  return { status: r.unlocked_at ? "revising" : "submitted", revision: num(r.revision), submittedAt: num(r.submitted_at) };
}

/** The student may read a part only if it is open. Hidden or locked parts are denied on the server. */
export function assertStudentCanRead(sc: StudentCtx, part: number) {
  const v = partVisibility(num(sc.session.id), part);
  if (v !== "open") throw forbidden(v === "hidden" ? "This part is not available." : "This part is locked until your teacher unlocks it.", "part_locked");
}
export function assertStudentCanEdit(sc: StudentCtx, part: number) {
  assertStudentCanRead(sc, part);
  if (submissionInfo(num(sc.group.id), part).status === "submitted")
    throw forbidden("Your group has already submitted this part. Ask your teacher to unlock it for revisions.", "part_submitted");
}

export function onlineEditors(groupId: number, part: number, exceptStudentId?: number) {
  return all(
    "SELECT p.student_id,p.editing_entry_id,s.name,s.class,s.class_no FROM presence p JOIN students s ON s.id=p.student_id WHERE p.group_id=? AND p.part=? AND p.last_beat>? AND p.editing_entry_id IS NOT NULL",
    groupId,
    part,
    now() - ONLINE_WINDOW_MS
  ).filter((r) => num(r.student_id) !== exceptStudentId);
}
