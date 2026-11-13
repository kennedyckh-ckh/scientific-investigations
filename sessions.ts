import crypto from "node:crypto";
import { all, get, run, tx, now, num, type Row } from "./db";
import { DEFAULT_CRITIQUE_PROMPTS } from "./constants";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newJoinCode(): string {
  for (let i = 0; i < 20; i++) {
    let c = "";
    const b = crypto.randomBytes(6);
    for (let j = 0; j < 6; j++) c += ALPHABET[b[j] % ALPHABET.length];
    if (!get("SELECT 1 FROM sessions WHERE join_code=?", c)) return c;
  }
  throw new Error("Could not allocate join code");
}

/** Creates a session. If a template id is given it is COPIED: later edits never touch the master. */
export function createSession(teacherId: number, title: string, templateId?: number): number {
  return tx(() => {
    const tpl = templateId ? get("SELECT * FROM templates WHERE id=?", templateId) : undefined;
    const sid = run(
      "INSERT INTO sessions(teacher_id,title,join_code,status,source_template_id,source_version,pedagogy_notes,critique_prompts_json,ai_criteria,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      teacherId,
      title,
      newJoinCode(),
      "active",
      tpl ? num(tpl.id) : null,
      tpl ? num(tpl.version) : null,
      tpl ? String(tpl.pedagogy_notes) : "",
      JSON.stringify(DEFAULT_CRITIQUE_PROMPTS),
      tpl ? String(tpl.ai_criteria) : "",
      now()
    ).id;
    for (const part of [1, 2, 3]) {
      const tp = tpl ? get("SELECT * FROM template_parts WHERE template_id=? AND part=?", num(tpl.id), part) : undefined;
      run(
        "INSERT INTO session_parts(session_id,part,instructions,web_link,visibility) VALUES(?,?,?,?,?)",
        sid,
        part,
        tp ? String(tp.instructions) : "",
        tp ? String(tp.web_link) : "",
        part === 1 ? "open" : "visible"
      );
      if (tpl) {
        for (const q of all("SELECT text,position FROM template_questions WHERE template_id=? AND part=? ORDER BY position", num(tpl.id), part)) {
          run("INSERT INTO session_questions(session_id,part,position,text) VALUES(?,?,?,?)", sid, part, num(q.position), String(q.text));
        }
      }
    }
    run("INSERT INTO groups(session_id,name) VALUES(?,?)", sid, "Group A");
    run("INSERT INTO groups(session_id,name) VALUES(?,?)", sid, "Group B");
    return sid;
  });
}

export function questionsFor(sessionId: number, part: number): { id: number; text: string }[] {
  return all("SELECT id,text FROM session_questions WHERE session_id=? AND part=? ORDER BY position,id", sessionId, part).map((q) => ({ id: num(q.id), text: String(q.text) }));
}

export function partConfig(sessionId: number) {
  return [1, 2, 3].map((part) => {
    const p = get("SELECT * FROM session_parts WHERE session_id=? AND part=?", sessionId, part)!;
    return {
      part,
      instructions: String(p.instructions),
      webLink: String(p.web_link),
      visibility: String(p.visibility),
      questions: questionsFor(sessionId, part),
    };
  });
}

export function setQuestions(sessionId: number, part: number, questions: string[]) {
  run("DELETE FROM session_questions WHERE session_id=? AND part=?", sessionId, part);
  questions.forEach((q, i) => run("INSERT INTO session_questions(session_id,part,position,text) VALUES(?,?,?,?)", sessionId, part, i, q));
}

export function activeGroupIds(sessionId: number): number[] {
  return all("SELECT g.id FROM groups g WHERE g.session_id=? AND EXISTS(SELECT 1 FROM students s WHERE s.group_id=g.id)", sessionId).map((r) => num(r.id));
}

export function sessionRow(id: number): Row {
  return get("SELECT * FROM sessions WHERE id=?", id)!;
}
