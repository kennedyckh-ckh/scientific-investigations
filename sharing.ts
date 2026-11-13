import { all, get, num, type Row } from "./db";
import { toDto } from "./entries";

const BASE =
  "SELECT e.*, s.name AS s_name, s.class AS s_class, s.class_no AS s_class_no FROM entries e JOIN students s ON s.id=e.student_id WHERE e.id=?";

export function critiquePromptsOf(session: Row): { key: string; label: string; enabled: boolean }[] {
  try {
    return JSON.parse(String(session.critique_prompts_json));
  } catch {
    return [];
  }
}

/**
 * What the whole class may see. Anonymisation is applied HERE, on the server:
 * when the session is anonymised, neither group names nor student names leave this function.
 */
export function publishedShares(session: Row, viewerStudentId?: number) {
  const sid = num(session.id);
  const anon = !!num(session.anonymise_sharing);
  const prompts = critiquePromptsOf(session);
  const shares = all("SELECT * FROM shares WHERE session_id=? ORDER BY seq", sid);
  return shares
    .map((sh) => {
      const er = get(BASE, num(sh.entry_id));
      if (!er || er.deleted_at) return null;
      const e = toDto(er);
      const g = get("SELECT name FROM groups WHERE id=?", e.groupId)!;
      const critiques = all(
        "SELECT c.*, g.name AS g_name FROM critiques c JOIN students s ON s.id=c.student_id JOIN groups g ON g.id=s.group_id WHERE c.share_id=? AND c.hidden=0 ORDER BY c.id",
        num(sh.id)
      ).map((c) => ({
        id: num(c.id),
        promptKey: String(c.prompt_key),
        promptLabel: prompts.find((p) => p.key === c.prompt_key)?.label || String(c.prompt_key),
        body: String(c.body),
        mine: viewerStudentId !== undefined && num(c.student_id) === viewerStudentId,
        authorLabel: anon ? "A classmate" : String(c.g_name),
        createdAt: num(c.created_at),
      }));
      return {
        shareId: num(sh.id),
        entryId: e.id,
        label: anon ? `Sample Response #${num(sh.seq)}` : String(g.name),
        part: e.part,
        tag: e.tag,
        body: e.body,
        hasImage: e.hasImage,
        table: e.table,
        critiques,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Published group summaries / cross-group comparisons and REVEALED discussion points only. */
export function publishedAi(sessionId: number) {
  return all(
    "SELECT * FROM ai_outputs WHERE session_id=? AND ((kind IN ('group_summary','cross_group') AND status IN ('published','revealed')) OR (kind='discussion_points' AND status='revealed')) ORDER BY id",
    sessionId
  ).map((o) => ({
    id: num(o.id),
    kind: String(o.kind),
    part: num(o.part),
    content: JSON.parse(String(o.content_json)),
  }));
}
