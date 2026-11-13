// Optional: fills a RUNNING server with a realistic demo class so you can explore every screen.
//   BASE=http://localhost:3200 node scripts/seed-demo.mjs
const BASE = process.env.BASE || "http://localhost:3200";
const actor = () => ({ cookies: {} });
async function api(who, method, path, body) {
  const res = await fetch(BASE + "/api" + path, {
    method,
    headers: { Cookie: Object.entries(who.cookies).map(([k, v]) => `${k}=${v}`).join("; "), ...(method !== "GET" ? { "Content-Type": "application/json" } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";"); const i = kv.indexOf("=");
    who.cookies[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(j)}`);
  return j;
}
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const t = actor();
await api(t, "POST", "/auth/login", { email: "teacher1@school.test", password: "Teacher1!demo" });
const asg = (await api(t, "GET", "/teacher/assigned-templates")).templates[0];
const sid = (await api(t, "POST", "/teacher/sessions", { title: "Demo: Year 8 Absorbency", assignmentId: asg.assignmentId })).id;
const S = await api(t, "GET", `/teacher/sessions/${sid}`);
const [gA, gB] = S.groups.map((g) => g.id);
await api(t, "PATCH", `/teacher/sessions/${sid}/groups/${gA}`, { name: "Group A", pin: "", seatCap: 4 });

const join = async (name, no, g) => { const a = actor(); await api(a, "POST", "/student/join", { code: S.joinCode, name, class: "8A", classNo: no, groupId: g }); return a; };
const amy = await join("Amy Chan", "3", gA), ben = await join("Ben Lau", "11", gA), cat = await join("Cat Wong", "7", gB), dan = await join("Dan Ho", "15", gB);
const add = (who, part, tag, body, extra = {}) => api(who, "POST", "/student/entries", { part, tag, body, ...extra });

await add(amy, 1, "Aim", "To find out which brand of paper towel absorbs the most water.");
await add(amy, 1, "Hypothesis", "Brand B will absorb the most because it is thicker.");
await add(ben, 1, "Independent variable", "The brand of paper towel (A, B, C).");
await add(ben, 1, "Dependent variable", "Volume of water absorbed, measured in ml.");
await add(cat, 1, "Hypothesis", "Thinner towels will hold more water because water fits between the fibres.");
await add(cat, 1, "Control variable", "Same size of towel (10 cm x 10 cm) and same soaking time (30 s).");
await add(dan, 1, "Independent variable", "Thickness of the towel.");
for (const [who, g] of [[amy, gA], [cat, gB]]) await api(who, "POST", "/student/submit", { part: 1, confirm: true });

await api(t, "POST", `/teacher/sessions/${sid}/parts/2/visibility`, { visibility: "open" });
await add(amy, 2, "Observation", "Brand B soaked up the most water.", { table: { columns: ["Brand", "Water absorbed (ml)"], rows: [["A", "40"], ["B", "55"], ["C", "30"]] }, image: PNG });
await add(ben, 2, "Evidence", "Brand B always absorbs more, so thick towels are better.");
await add(cat, 2, "Observation", "Brand B absorbed 90 ml in our test; Brand A 62 ml.");
await add(dan, 2, "Limitation", "We did not time the soaking exactly, so it may not be a fair test.");
await api(amy, "POST", "/student/submit", { part: 2, confirm: true });

const entries = (await api(t, "GET", `/teacher/sessions/${sid}/entries?part=2`)).entries;
await api(t, "POST", `/teacher/sessions/${sid}/shares`, { entryIds: entries.slice(0, 3).map((e) => e.id) });
await api(t, "PATCH", `/teacher/sessions/${sid}`, { anonymiseSharing: true });
const cg = await api(t, "POST", `/teacher/sessions/${sid}/ai/generate`, { kind: "cross_group", part: 2 });
const dp = await api(t, "POST", `/teacher/sessions/${sid}/ai/generate`, { kind: "discussion_points", part: 2 });
await api(t, "POST", `/teacher/sessions/${sid}/ai/${cg.id}/publish`, { reviewed: true });
await api(t, "POST", `/teacher/sessions/${sid}/ai/${dp.id}/reveal`, { reviewed: true });
await api(t, "POST", `/teacher/sessions/${sid}/ai/generate`, { kind: "group_summary", part: 2, groupId: gA });

console.log(`Demo session ready. Join code: ${S.joinCode}  (teacher1@school.test / Teacher1!demo, session id ${sid})`);
