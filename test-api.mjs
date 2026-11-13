// End-to-end permission & workflow tests against a RUNNING server (fresh database recommended).
// Usage: BASE=http://localhost:3100 node scripts/test-api.mjs
const BASE = process.env.BASE || "http://localhost:3100";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let pass = 0;
const fails = [];
const section = (s) => console.log(`\n== ${s}`);
function check(label, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fails.push(label);
    console.log(`  FAIL ${label} ${extra}`);
  }
}
const eq = (label, a, b) => check(label, a === b, `(got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

function actor(name) {
  return { name, cookies: {} };
}
async function api(who, method, path, body, opts = {}) {
  const headers = { Cookie: Object.entries(who.cookies).map(([k, v]) => `${k}=${v}`).join("; ") };
  if (method !== "GET") headers["Content-Type"] = opts.contentType || "application/json";
  const res = await fetch(BASE + "/api" + path, {
    method,
    headers,
    body: method === "GET" ? undefined : opts.rawBody ?? JSON.stringify(body ?? {}),
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    const k = kv.slice(0, i);
    const v = decodeURIComponent(kv.slice(i + 1));
    if (/Max-Age=0/i.test(c) || v === "") delete who.cookies[k];
    else who.cookies[k] = v;
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const login = async (who, email, password) => api(who, "POST", "/auth/login", { email, password });

async function main() {
  const t1 = actor("teacher1"), t2 = actor("teacher2"), t3 = actor("teacher3"), ed = actor("educator");
  const anon = actor("anon");

  section("Authentication & RBAC");
  eq("wrong password -> 401", (await login(actor("x"), "teacher1@school.test", "nope")).status, 401);
  eq("teacher1 login", (await login(t1, "teacher1@school.test", "Teacher1!demo")).status, 200);
  eq("teacher2 login", (await login(t2, "teacher2@school.test", "Teacher2!demo")).status, 200);
  eq("teacher3 login", (await login(t3, "teacher3@school.test", "Teacher3!demo")).status, 200);
  eq("educator login", (await login(ed, "educator@school.test", "Educator1!demo")).status, 200);
  eq("unauthenticated teacher route -> 401", (await api(anon, "GET", "/teacher/sessions")).status, 401);
  eq("unauthenticated educator route -> 401", (await api(anon, "GET", "/educator/templates")).status, 401);
  eq("educator cannot list teacher sessions", (await api(ed, "GET", "/teacher/sessions")).status, 403);
  eq("educator cannot create a session", (await api(ed, "POST", "/teacher/sessions", { title: "x" })).status, 403);
  eq("teacher cannot open educator templates", (await api(t1, "GET", "/educator/templates")).status, 403);
  eq("non-JSON mutation rejected (CSRF guard)", (await api(anon, "POST", "/auth/login", null, { contentType: "text/plain", rawBody: "a=b" })).status, 415);

  section("Teacher Educator templates & assignment");
  const tpls = (await api(ed, "GET", "/educator/templates")).json.templates;
  check("educator sees the sample template", tpls.length >= 1);
  const tplId = tpls[0].id;
  const tplBefore = (await api(ed, "GET", `/educator/templates/${tplId}`)).json;
  const teachers = (await api(ed, "GET", "/educator/teachers")).json.teachers;
  eq("educator supports 2 teachers", teachers.length, 2);
  const t3id = (await api(t3, "GET", "/auth/me")).json.staff.id;
  eq("educator cannot assign to an unsupported teacher", (await api(ed, "POST", `/educator/templates/${tplId}/assign`, { teacherIds: [t3id] })).status, 403);
  const newTpl = (await api(ed, "POST", "/educator/templates", { title: "Test template" })).json.id;
  check("educator creates template", !!newTpl);
  eq("educator edits template", (await api(ed, "PUT", `/educator/templates/${newTpl}`, { title: "Test template", pedagogyNotes: "n", aiCriteria: "c", parts: [1, 2, 3].map((p) => ({ part: p, instructions: `Inst ${p}`, webLink: "https://example.org", questions: [`Q${p}a`] })) })).status, 200);
  eq("unsafe link rejected", (await api(ed, "PUT", `/educator/templates/${newTpl}`, { title: "T", parts: [1, 2, 3].map((p) => ({ part: p, instructions: "", webLink: "javascript:alert(1)", questions: [] })) })).status, 400);
  const t1id = teachers.find((t) => t.email === "teacher1@school.test").id;
  eq("educator assigns to teacher1", (await api(ed, "POST", `/educator/templates/${newTpl}/assign`, { teacherIds: [t1id], note: "hi", refLinks: [{ label: "Ref", url: "https://example.org/r" }] })).status, 200);
  const t1assigned = (await api(t1, "GET", "/teacher/assigned-templates")).json.templates;
  check("teacher1 sees assigned templates (incl. new one)", t1assigned.some((a) => a.title === "Test template"));
  eq("teacher3 has no assigned templates", (await api(t3, "GET", "/teacher/assigned-templates")).json.templates.length, 0);
  const asg = t1assigned.find((a) => a.templateId === tplId);
  eq("teacher3 cannot import teacher1's assignment", (await api(t3, "POST", "/teacher/sessions", { title: "steal", assignmentId: asg.assignmentId })).status, 403);

  section("Sessions: import as copy, ownership");
  const sid = (await api(t1, "POST", "/teacher/sessions", { title: "Period 3 Investigation", assignmentId: asg.assignmentId })).json.id;
  check("teacher1 creates session from template", !!sid);
  let S = (await api(t1, "GET", `/teacher/sessions/${sid}`)).json;
  eq("template instructions copied to session", S.parts[0].instructions, tplBefore.parts[0].instructions);
  eq("guiding questions copied", S.parts[0].questions.length, tplBefore.parts[0].questions.length);
  eq("Part 1 open, Part 2 locked by default", [S.parts[0].visibility, S.parts[1].visibility, S.parts[2].visibility].join(","), "open,visible,visible");
  await api(t1, "PUT", `/teacher/sessions/${sid}/parts/1`, { instructions: "CUSTOMISED by teacher", webLink: "https://example.org/p1", questions: ["Custom Q1", "Custom Q2"] });
  const tplAfter = (await api(ed, "GET", `/educator/templates/${tplId}`)).json;
  eq("master template NOT altered by teacher edits", tplAfter.parts[0].instructions, tplBefore.parts[0].instructions);
  eq("master template version unchanged", tplAfter.version, tplBefore.version);
  eq("teacher2 cannot read teacher1's session", (await api(t2, "GET", `/teacher/sessions/${sid}`)).status, 404);
  eq("teacher2 cannot read its status", (await api(t2, "GET", `/teacher/sessions/${sid}/status`)).status, 404);
  eq("educator cannot read a live session", (await api(ed, "GET", `/teacher/sessions/${sid}`)).status, 403);
  eq("educator cannot unlock submissions", (await api(ed, "POST", `/teacher/sessions/${sid}/unlock-submission`, { groupId: 1, part: 1 })).status, 403);
  eq("educator cannot view student entries", (await api(ed, "GET", `/teacher/sessions/${sid}/entries`)).status, 403);

  section("Groups: PIN and seat cap");
  const gA = S.groups[0].id, gB = S.groups[1].id;
  const gC = (await api(t1, "POST", `/teacher/sessions/${sid}/groups`, { name: "Group C", pin: "abc12", seatCap: 1 })).json.id;
  check("teacher creates PIN+cap group", !!gC);
  eq("bad PIN format rejected", (await api(t1, "POST", `/teacher/sessions/${sid}/groups`, { name: "Z", pin: "!!" })).status, 400);
  const code = S.joinCode;
  eq("unknown join code -> 404", (await api(anon, "GET", "/join/ZZZZZZ")).status, 404);
  const lookup = (await api(anon, "GET", `/join/${code}`)).json;
  check("join lookup hides PIN value", !JSON.stringify(lookup).includes("abc12"));
  eq("join lookup reports PIN needed", lookup.groups.find((g) => g.id === gC).hasPin, true);

  const s1 = actor("alice"), s2 = actor("bob"), s3 = actor("cara"), s4 = actor("dan"), s5 = actor("eve");
  const join = (who, name, no, groupId, pin) => api(who, "POST", "/student/join", { code, name, class: "8A", classNo: no, groupId, pin });
  eq("student joins group A", (await join(s1, "Alice Lee", "1", gA)).status, 200);
  eq("second student joins group A", (await join(s2, "Bob Tam", "2", gA)).status, 200);
  eq("student joins group B", (await join(s3, "Cara Ng", "3", gB)).status, 200);
  eq("PIN group without PIN -> 403", (await join(s4, "Dan Yu", "4", gC)).status, 403);
  eq("PIN group with wrong PIN -> 403", (await join(s4, "Dan Yu", "4", gC, "wrong")).status, 403);
  eq("PIN group with right PIN OK", (await join(s4, "Dan Yu", "4", gC, "abc12")).status, 200);
  const full = await join(s5, "Eve Ho", "5", gC, "abc12");
  eq("seat cap enforced (group full)", full.json?.error, "group_full");
  eq("missing name rejected", (await api(actor("n"), "POST", "/student/join", { code, name: "", class: "8A", classNo: "9", groupId: gA })).status, 400);

  section("Session recovery (refresh / new device)");
  eq("same browser rejoin resumes", (await join(s1, "alice lee", "1", gA)).json.resumed, true);
  eq("cookie alone restores the student", (await api(s1, "GET", "/student/state")).json.student.name, "Alice Lee");
  const s1b = actor("alice-phone");
  const r1 = await join(s1b, "Alice Lee", "1", gA);
  eq("new device, unpinned group -> needs teacher approval", r1.json?.error, "needs_approval");
  eq("student with no token cannot read state", (await api(s1b, "GET", "/student/state")).status, 401);
  let st = (await api(t1, "GET", `/teacher/sessions/${sid}/status`)).json;
  eq("teacher sees the pending device request", st.recovery.length, 1);
  eq("teacher approves device", (await api(t1, "POST", `/teacher/sessions/${sid}/recovery/${st.recovery[0].id}/approve`)).status, 200);
  eq("approved device can resume", (await join(s1b, "Alice Lee", "1", gA)).status, 200);
  eq("approval is single-use", (await join(actor("alice-3"), "Alice Lee", "1", gA)).json?.error, "needs_approval");
  const s4b = actor("dan-phone");
  eq("PIN group: device switch needs PIN", (await join(s4b, "Dan Yu", "4", gC)).json?.error, "pin_required");
  eq("PIN group: device switch with PIN works", (await join(s4b, "Dan Yu", "4", gC, "abc12")).status, 200);

  section("Part visibility & locking (server-enforced)");
  let state = (await api(s1, "GET", "/student/state")).json;
  eq("student sees 3 parts", state.parts.length, 3);
  check("locked Part 2 carries no instructions/questions", state.parts[1].locked && !("instructions" in state.parts[1]) && !("questions" in state.parts[1]));
  eq("Part 2 entries -> 403 while locked", (await api(s1, "GET", "/student/entries?part=2")).status, 403);
  eq("Part 2 entry creation -> 403 while locked", (await api(s1, "POST", "/student/entries", { part: 2, body: "sneaky" })).status, 403);
  eq("Part 2 reference -> 403 while locked", (await api(s1, "GET", "/student/reference?part=2")).status, 403);
  await api(t1, "POST", `/teacher/sessions/${sid}/parts/3/visibility`, { visibility: "hidden" });
  state = (await api(s1, "GET", "/student/state")).json;
  eq("hidden Part 3 is absent from student state", state.parts.length, 2);
  eq("hidden Part 3 entries -> 403", (await api(s1, "GET", "/student/entries?part=3")).status, 403);
  await api(t1, "POST", `/teacher/sessions/${sid}/parts/3/visibility`, { visibility: "visible" });

  section("Entries: separate per-member, tags, image, table");
  const e1 = (await api(s1, "POST", "/student/entries", { part: 1, tag: "Hypothesis", body: "Thicker towels absorb more", image: PNG })).json.entry;
  check("entry created with contributor identity", e1 && e1.author.name === "Alice Lee" && e1.author.class === "8A" && e1.author.classNo === "1" && e1.tag === "Hypothesis" && e1.hasImage);
  const e2 = (await api(s2, "POST", "/student/entries", { part: 1, tag: "Aim", body: "Compare three brands", table: { columns: ["Brand", "ml"], rows: [["A", "40"], ["B", "55"]] } })).json.entry;
  check("second member adds a separate entry", e2 && e2.id !== e1.id && e2.table.rows.length === 2);
  let list = (await api(s2, "GET", "/student/entries?part=1")).json;
  eq("group members see each other's entries (sync)", list.entries.length, 2);
  eq("teammate entry flagged not mine", list.entries.find((e) => e.id === e1.id).mine, false);
  eq("teammate cannot edit my entry", (await api(s2, "PATCH", `/student/entries/${e1.id}`, { body: "overwrite!" })).status, 403);
  eq("teammate cannot delete my entry", (await api(s2, "DELETE", `/student/entries/${e1.id}`)).status, 403);
  eq("other group cannot edit my entry (404)", (await api(s3, "PATCH", `/student/entries/${e1.id}`, { body: "x" })).status, 404);
  eq("other group sees nothing of group A", (await api(s3, "GET", "/student/entries?part=1")).json.entries.length, 0);
  eq("owner edits own entry (autosave)", (await api(s1, "PATCH", `/student/entries/${e1.id}`, { body: "Thicker towels absorb more water" })).json.entry.body, "Thicker towels absorb more water");
  eq("stale edit detected", (await api(s1, "PATCH", `/student/entries/${e1.id}`, { body: "old", baseUpdatedAt: 1 })).json?.error, "stale");
  eq("unknown tag rejected", (await api(s1, "POST", "/student/entries", { part: 1, tag: "Banana" })).status, 400);
  eq("fake image rejected (signature check)", (await api(s1, "POST", "/student/entries", { part: 1, image: "data:image/png;base64," + Buffer.from("this is not a png at all").toString("base64") })).status, 400);
  eq("SVG upload rejected", (await api(s1, "POST", "/student/entries", { part: 1, image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).status, 400);
  eq("oversized table rejected", (await api(s1, "POST", "/student/entries", { part: 1, table: { columns: Array(20).fill("c"), rows: [] } })).status, 400);
  eq("overlong text rejected", (await api(s1, "POST", "/student/entries", { part: 1, body: "x".repeat(5000) })).status, 400);
  const img = await fetch(`${BASE}/api/images/${e1.id}`, { headers: { Cookie: `si_student=${s2.cookies.si_student}` } });
  eq("teammate can load the group image", img.status, 200);
  eq("image served with nosniff", img.headers.get("x-content-type-options"), "nosniff");
  eq("other group cannot load the image", (await api(s3, "GET", `/images/${e1.id}`)).status, 404);
  const timg = await fetch(`${BASE}/api/images/${e1.id}`, { headers: { Cookie: `si_staff=${t1.cookies.si_staff}` } });
  eq("owning teacher loads image", timg.status, 200);
  const t2img = await fetch(`${BASE}/api/images/${e1.id}`, { headers: { Cookie: `si_staff=${t2.cookies.si_staff}` } });
  eq("other teacher cannot load image", t2img.status, 404);

  section("Collective submission safeguard");
  eq("presence heartbeat", (await api(s2, "POST", "/student/presence", { part: 1, editingEntryId: e2.id })).status, 200);
  const chk = (await api(s1, "GET", "/student/submit-check?part=1")).json;
  eq("submit-check lists all contributors", chk.members.length, 2);
  eq("submit-check warns about an active editor", chk.editors.length, 1);
  eq("submit requires confirmation", (await api(s1, "POST", "/student/submit", { part: 1 })).json?.error, "confirm_required");
  eq("submit blocked while a teammate has unsaved work", (await api(s1, "POST", "/student/submit", { part: 1, confirm: true })).json?.error, "editors_active");
  await api(s2, "POST", "/student/presence", { part: 1, editingEntryId: null });
  eq("empty group cannot submit", (await api(s3, "POST", "/student/submit", { part: 1, confirm: true })).json?.error, "nothing_to_submit");
  const sub1 = await api(s1, "POST", "/student/submit", { part: 1, confirm: true });
  eq("group submits Part 1", sub1.json?.submission?.status, "submitted");
  eq("teammate cannot edit after submission", (await api(s2, "PATCH", `/student/entries/${e2.id}`, { body: "late" })).json?.error, "part_submitted");
  eq("cannot add entries after submission", (await api(s2, "POST", "/student/entries", { part: 1, body: "late" })).json?.error, "part_submitted");
  eq("cannot submit twice", (await api(s2, "POST", "/student/submit", { part: 1, confirm: true })).status, 403);

  section("Stage unlocking & deliberate override");
  const blocked = await api(t1, "POST", `/teacher/sessions/${sid}/parts/2/visibility`, { visibility: "open" });
  eq("unlock Part 2 blocked: a group is missing", blocked.json?.error, "groups_missing");
  eq("override needs a reason", (await api(t1, "POST", `/teacher/sessions/${sid}/parts/2/visibility`, { visibility: "open", override: true })).status, 400);
  eq("teacher2 cannot unlock teacher1's part", (await api(t2, "POST", `/teacher/sessions/${sid}/parts/2/visibility`, { visibility: "open", override: true, reason: "x" })).status, 404);
  eq("deliberate override unlocks Part 2", (await api(t1, "POST", `/teacher/sessions/${sid}/parts/2/visibility`, { visibility: "open", override: true, reason: "Group B is absent today" })).status, 200);
  st = (await api(t1, "GET", `/teacher/sessions/${sid}/status`)).json;
  eq("override is recorded", st.overrides.length, 1);
  const sum1 = st.summary.find((s) => s.part === 1);
  eq("status counts submitted groups", `${sum1.submitted}/${sum1.activeGroups}`, "1/3");
  state = (await api(s1, "GET", "/student/state")).json;
  check("Part 2 now shows instructions", state.parts[1].locked === false && typeof state.parts[1].instructions === "string");

  section("Reference panel & preserved Part 1");
  const ref = (await api(s1, "GET", "/student/reference?part=2")).json;
  eq("Part 2 reference shows submitted Part 1", ref.parts[0].entries.length, 2);
  const p2 = (await api(s1, "POST", "/student/entries", { part: 2, tag: "Observation", body: "B soaked up 55 ml" })).json.entry;
  check("Part 2 entry stored separately", p2.part === 2);
  eq("Part 1 entries unchanged by Part 2 work", (await api(s1, "GET", "/student/entries?part=1")).json.entries.length, 2);
  eq("Part 3 reference still locked", (await api(s1, "GET", "/student/reference?part=3")).status, 403);
  eq("cross-group reference isolation (group B has no Part 1 submission)", (await api(s3, "GET", "/student/reference?part=2")).json.parts[0].submitted, false);

  section("Unlock a submission for revision");
  eq("student cannot unlock", (await api(s1, "POST", `/teacher/sessions/${sid}/unlock-submission`, { groupId: gA, part: 1 })).status, 401);
  eq("teacher unlocks Group A Part 1", (await api(t1, "POST", `/teacher/sessions/${sid}/unlock-submission`, { groupId: gA, part: 1 })).status, 200);
  eq("group can revise after unlock", (await api(s2, "PATCH", `/student/entries/${e2.id}`, { body: "Compare three brands fairly" })).status, 200);
  eq("resubmission creates revision 2", (await api(s2, "POST", "/student/submit", { part: 1, confirm: true })).json?.submission?.revision, 2);

  section("Teacher reads contributions");
  const all1 = (await api(t1, "GET", `/teacher/sessions/${sid}/entries?groupId=${gA}&part=1`)).json.entries;
  check("teacher sees name/class/class no/tag", all1.every((e) => e.author.name && e.author.class && e.author.classNo) && all1.some((e) => e.tag === "Hypothesis") && all1.some((e) => e.hasImage) && all1.some((e) => e.table));

  section("Controlled sharing, anonymisation, critique");
  eq("student sees nothing shared yet", (await api(s3, "GET", "/student/class")).json.shares.length, 0);
  eq("critique on unshared entry impossible", (await api(s3, "POST", "/student/critiques", { shareId: 1, promptKey: "clarify", body: "?" })).status, 404);
  eq("student cannot publish shares", (await api(s1, "POST", `/teacher/sessions/${sid}/shares`, { entryIds: [e1.id] })).status, 401);
  eq("teacher2 cannot share teacher1's entries", (await api(t2, "POST", `/teacher/sessions/${sid}/shares`, { entryIds: [e1.id] })).status, 404);
  eq("teacher shares an entry", (await api(t1, "POST", `/teacher/sessions/${sid}/shares`, { entryIds: [e1.id, e2.id] })).json?.added, 2);
  let cls = (await api(s3, "GET", "/student/class")).json;
  eq("other group now sees 2 shared entries", cls.shares.length, 2);
  eq("group name shown when not anonymised", cls.shares[0].label, "Group A");
  check("no student names exposed to class", !JSON.stringify(cls).includes("Alice") && !JSON.stringify(cls).includes("Bob"));
  await api(t1, "PATCH", `/teacher/sessions/${sid}`, { anonymiseSharing: true });
  cls = (await api(s3, "GET", "/student/class")).json;
  eq("anonymised label", cls.shares[0].label, "Sample Response #1");
  check("group names AND student names absent when anonymised", !JSON.stringify(cls).includes("Group A") && !JSON.stringify(cls).includes("Alice"));
  const simg = await fetch(`${BASE}/api/images/${e1.id}`, { headers: { Cookie: `si_student=${s3.cookies.si_student}` } });
  eq("shared image visible to class", simg.status, 200);
  const crit = await api(s3, "POST", "/student/critiques", { shareId: cls.shares[0].shareId, promptKey: "confounding", body: "Towel size may differ" });
  eq("peer critique posted", crit.status, 200);
  eq("disabled critique prompt rejected", (await api(s3, "POST", "/student/critiques", { shareId: cls.shares[0].shareId, promptKey: "improve", body: "x" })).status, 400);
  cls = (await api(s1, "GET", "/student/class")).json;
  eq("critique visible to class, author anonymised", cls.shares[0].critiques[0].authorLabel, "A classmate");
  await api(t1, "POST", `/teacher/sessions/${sid}/critiques/${cls.shares[0].critiques[0].id}/hide`, { hidden: true });
  eq("teacher can hide a critique", (await api(s1, "GET", "/student/class")).json.shares[0].critiques.length, 0);

  section("Projector view shows only published content");
  const unshared = (await api(s1, "POST", "/student/entries", { part: 2, body: "PRIVATE-DRAFT-TEXT" })).json.entry;
  const proj = (await api(t1, "GET", `/teacher/sessions/${sid}/projector`)).json;
  check("projector has shared entries", proj.shares.length === 2);
  check("projector excludes unshared drafts and names", !JSON.stringify(proj).includes("PRIVATE-DRAFT-TEXT") && !JSON.stringify(proj).includes("Alice") && !JSON.stringify(proj).includes("Group A"));
  eq("student cannot open projector endpoint", (await api(s1, "GET", `/teacher/sessions/${sid}/projector`)).status, 401);
  void unshared;

  section("Export");
  await api(s1, "POST", "/student/entries", { part: 2, tag: "Evidence", body: "=HYPERLINK(\"http://evil\")" });
  const csv = await api(t1, "GET", `/teacher/sessions/${sid}/export?format=csv`);
  eq("CSV export OK", csv.status, 200);
  check("CSV has student name/class/class no/tag/stage", /Alice Lee/.test(csv.text) && /"8A"/.test(csv.text) && /Hypothesis/.test(csv.text) && /Part 1: Designing/.test(csv.text));
  check("CSV neutralises spreadsheet formulas", csv.text.includes("\"'=HYPERLINK"));
  const js = (await api(t1, "GET", `/teacher/sessions/${sid}/export?format=json`)).json;
  check("JSON export has stages, questions and entries", js.stages.length === 3 && js.stages[0].guidingQuestions[0] === "Custom Q1" && js.entries.length >= 4);
  eq("other teacher cannot export", (await api(t2, "GET", `/teacher/sessions/${sid}/export?format=json`)).status, 404);
  eq("educator cannot export", (await api(ed, "GET", `/teacher/sessions/${sid}/export?format=json`)).status, 403);

  section("Archive & delete");
  eq("cannot delete an active session", (await api(t1, "DELETE", `/teacher/sessions/${sid}`, { confirmTitle: "Period 3 Investigation" })).status, 403);
  eq("teacher archives", (await api(t1, "POST", `/teacher/sessions/${sid}/archive`)).status, 200);
  eq("archived session: student edits blocked", (await api(s1, "POST", "/student/entries", { part: 2, body: "x" })).json?.error, "session_archived");
  eq("archived session: join code stops working", (await api(anon, "GET", `/join/${code}`)).status, 404);
  eq("delete needs the title typed", (await api(t1, "DELETE", `/teacher/sessions/${sid}`, { confirmTitle: "nope" })).status, 400);
  eq("teacher deletes archived session", (await api(t1, "DELETE", `/teacher/sessions/${sid}`, { confirmTitle: "Period 3 Investigation" })).status, 200);
  eq("deleted session: student cookie is useless", (await api(s1, "GET", "/student/state")).status, 401);

  section("Logout");
  await api(t1, "POST", "/auth/logout");
  eq("after logout teacher route -> 401", (await api(t1, "GET", "/teacher/sessions")).status, 401);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) {
    console.log("Failures:\n - " + fails.join("\n - "));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
