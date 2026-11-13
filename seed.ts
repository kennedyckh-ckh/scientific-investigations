import { all, get, run, tx, now, num } from "./db";
import { hashPassword } from "./auth";

export const DEMO_ACCOUNTS = [
  { role: "teacher", name: "Ms Chan (Teacher 1)", email: "teacher1@school.test", password: "Teacher1!demo" },
  { role: "teacher", name: "Mr Lee (Teacher 2)", email: "teacher2@school.test", password: "Teacher2!demo" },
  { role: "teacher", name: "Ms Wong (Teacher 3)", email: "teacher3@school.test", password: "Teacher3!demo" },
  { role: "educator", name: "Dr Ng (Teacher Educator)", email: "educator@school.test", password: "Educator1!demo" },
] as const;

export function seedIfEmpty() {
  if (get("SELECT 1 FROM users LIMIT 1")) return;
  tx(() => {
    const ids: Record<string, number> = {};
    for (const a of DEMO_ACCOUNTS) {
      ids[a.email] = run("INSERT INTO users(role,name,email,password_hash,created_at) VALUES(?,?,?,?,?)", a.role, a.name, a.email, hashPassword(a.password), now()).id;
    }
    const ed = ids["educator@school.test"];
    // The educator is responsible for Teachers 1 and 2 only. Teacher 3 is deliberately unassigned (RBAC test).
    run("INSERT INTO educator_teacher(educator_id,teacher_id) VALUES(?,?)", ed, ids["teacher1@school.test"]);
    run("INSERT INTO educator_teacher(educator_id,teacher_id) VALUES(?,?)", ed, ids["teacher2@school.test"]);

    const tid = run(
      "INSERT INTO templates(educator_id,title,pedagogy_notes,ai_criteria,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      ed,
      "Which paper towel absorbs the most water?",
      "Rationale: students often treat 'fair test' as a slogan. Part 1 pushes them to name the independent, dependent and control variables before touching equipment. In Part 3, steer the class to compare their predictions with the data and to separate what the data show from what they believe. Watch for the misconception that 'thicker always means more absorbent'.",
      "Prioritise divergent findings between groups, uncontrolled variables (e.g. soaking time, towel size), gaps between evidence and claims, and misconceptions about absorption.",
      1,
      now(),
      now()
    ).id;
    const parts: Record<number, [string, string, string[]]> = {
      1: [
        "Plan a fair test to compare how much water different brands of paper towel can absorb. Decide what you will change, what you will measure and what you must keep the same. Write your aim and a hypothesis with a reason.",
        "https://www.stem.org.uk/",
        ["What is your aim, in one sentence?", "What will you change (independent variable) and what will you measure (dependent variable)?", "Which variables must you control, and how?", "What do you predict, and why?"],
      ],
      2: [
        "Carry out your plan. Record every observation and measurement. If you change the plan, write down what you changed and why.",
        "https://www.stem.org.uk/",
        ["What did you observe? Add a data table.", "Did anything go differently from your plan?", "Attach a photo of your set-up or your result."],
      ],
      3: [
        "Compare your results with your Part 1 plan. Use the Reference Panel to check your hypothesis and your controls against what actually happened.",
        "",
        ["Was your hypothesis supported? Which evidence shows this?", "What limitations affected your results?", "How would you improve the investigation?"],
      ],
    };
    for (const p of [1, 2, 3]) {
      run("INSERT INTO template_parts(template_id,part,instructions,web_link) VALUES(?,?,?,?)", tid, p, parts[p][0], parts[p][1]);
      parts[p][2].forEach((q, i) => run("INSERT INTO template_questions(template_id,part,position,text) VALUES(?,?,?,?)", tid, p, i, q));
    }
    for (const email of ["teacher1@school.test", "teacher2@school.test"]) {
      run(
        "INSERT INTO template_assignments(template_id,teacher_id,note,ref_links_json,assigned_at) VALUES(?,?,?,?,?)",
        tid,
        ids[email],
        "Please try this with your Year 8 class. Feel free to adapt the questions.",
        JSON.stringify([{ label: "Fair-testing background reading", url: "https://www.stem.org.uk/" }]),
        now()
      );
    }
  });
  void all; void num;
}
