# Scientific Investigations

A classroom web app for three-stage scientific investigations: **Part 1 Designing → Part 2 Enacting → Part 3 Reflecting**. Roles: Student, Teacher, Teacher Educator.

Next.js 15 (App Router) + TypeScript + Tailwind, with a real server-side API and a SQLite database (Node's built-in `node:sqlite`, so there is nothing native to compile).
**Requires Node 22.13 or newer.**

## Run it

```bash
npm install
npm run build
npm start            # http://localhost:3000  (for another port: npx next start -p 3200)
```

`npm run dev` works too. Data lives in `./data` (`app.db` + `uploads/`). Override with `DATA_DIR=/some/path`.
Optional demo class: with the app running, `BASE=http://localhost:3000 npm run seed:demo`.

## Test accounts (seeded on first start)

| Role | Email | Password |
|---|---|---|
| Teacher 1 | teacher1@school.test | `Teacher1!demo` |
| Teacher 2 | teacher2@school.test | `Teacher2!demo` |
| Teacher 3 | teacher3@school.test | `Teacher3!demo` |
| Teacher Educator | educator@school.test | `Educator1!demo` |

The educator supports Teachers 1 and 2 (they receive its templates). **Teacher 3 is deliberately unassigned**, so you can see access control refusing it. A sample template, *"Which paper towel absorbs the most water?"*, is shared with Teachers 1 and 2.
The sign-in page shows these accounts in a "Test accounts" box; set `HIDE_DEMO_ACCOUNTS=1` to hide it. **Change or remove these accounts before any real use.**

Students need no account: they enter the session **join code**, name, class, class number and pick a group.

## What is fully working (real) vs simulated

| Area | Status |
|---|---|
| Authentication, roles, backend access control, sessions, groups (PIN / seat cap), student join + recovery | **Real** (SQLite, server-side checks on every route) |
| Part 1–3 workspace: per-member entries, tags, picture + mini data table, autosave, polling sync, editing warnings, collective submit, Reference Panel | **Real** |
| Teacher dashboard: monitor, unlock parts / submissions, override, share, anonymise, critique, projector, export (CSV/JSON) | **Real** |
| Teacher Educator: templates, assignment, import-as-copy | **Real** |
| **AI analysis** | **SIMULATED.** A rule-based *mock analyser* produces the drafts. It is not a language model. Everything around it (citation checks, injection hardening, review/edit, Publish vs Reveal) is real. |
| Real-time sync | **Polling** every 4–6 s (not WebSockets) |
| Picture storage | Local disk (`data/uploads`), served only through permission-checked routes |
| Email, SSO, school roster import, virus scanning, backups, HTTPS | **Not included** |

## How access control works

Every API route calls one of the guards in `lib/authz.ts` before touching data:

* staff routes need a valid staff cookie **and** the right role; teacher routes additionally check the teacher **owns** the session (someone else's session answers 404, not 403, so ids don't leak)
* the Teacher Educator has **no** route into live sessions, entries, submissions, or AI drafts
* student routes need a student cookie; entries are scoped to the student's own **group**; a hidden or locked part returns 403 (no instructions or questions are sent for locked parts)
* students can only edit their **own** entries, only while the part is open and the group has not submitted
* shared content is built server-side (`lib/sharing.ts`); when anonymised, group and student names never leave the server
* AI drafts are teacher-only until the teacher publishes (summaries) or reveals (discussion points)
* all mutating routes accept JSON only (a cross-site form post cannot send it), cookies are `HttpOnly; SameSite=Lax`

Run the tests against a running server (a fresh database is best):

```bash
BASE=http://localhost:3100 npm run test:api    # 141 permission & workflow checks
BASE=http://localhost:3100 npm run test:ai     # 50 AI workflow & guardrail checks
npm run test:unit                              # 14 prompt-hardening / validation / fuzz checks
```

## Wiring a real LLM later

All AI code is in `lib/ai.ts` (pure, no database).

1. Implement `llmProvider.generate(req)`: call your model with `buildPrompt(req)` (system + user message) and return the parsed JSON.
2. Start the app with `AI_PROVIDER=llm`.

You do **not** need to touch the guardrails; the API handler runs `validateContent()` on whatever the provider returns and rejects replies that cite entries that don't exist, omit citations, or present "discussion points" as statements. `buildPrompt` already sends student text only as sanitised JSON inside a delimited `<student_data>` block, and student names are replaced with neutral labels (`Student A`, `Group 2`) before anything leaves the server.
Prompt injection can only ever be *mitigated* by this design, never fully ruled out for a real model. Keep the teacher review step.

## Known limitations (be aware before classroom use)

* **Student identity is classroom-grade, not account-grade.** Anyone with the join code who types a classmate's name/class/number *from a new device* needs the **group PIN** or a **teacher approval** to take over that identity, but there are no passwords. Use group PINs for sensitive classes.
* Login and PIN throttling is **in memory** and per process: it resets on restart, and a locked-out email is locked for 5 minutes. Put a reverse proxy / WAF in front for real deployments. The client IP is read from `X-Forwarded-For`, which only a trusted proxy should set.
* Set `COOKIE_SECURE=1` when serving over HTTPS.
* SQLite is a single file: fine for one class or school; take regular backups of `./data`.
* Pictures are limited to PNG/JPEG/WebP ≤ 3 MB, checked by file signature. EXIF data (e.g. location) is not stripped.
* Exports contain student names. Handle them under your school's data policy. Deleting a session removes its data and picture files.
* The mock analyser is heuristic: it spots tag gaps, different numbers, differing statements and absolute wording, not meaning.
