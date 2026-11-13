"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Field } from "@/components/ui";

interface Me {
  staff: { id: number; role: "teacher" | "educator"; name: string } | null;
  student: { name: string; sessionTitle: string; sessionStatus: string } | null;
}
interface Lookup {
  session: { title: string };
  groups: { id: number; name: string; hasPin: boolean; seatsLeft: number | null }[];
}
interface Demo {
  role: string;
  name: string;
  email: string;
  password: string;
}

export default function Home() {
  const [mode, setMode] = useState<"student" | "staff">("student");
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("GET", "/auth/me").then(setMe).catch(() => setMe({ staff: null, student: null }));
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-violet-50">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-2 md:py-20">
        <div className="flex flex-col justify-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-700 to-violet-600 text-3xl text-white shadow-lg" aria-hidden>
            ⚗
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Scientific Investigations</h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">Design an investigation, carry it out, then reflect on what really happened, together with your group.</p>
          <ol className="mt-6 space-y-3 text-sm text-slate-700">
            {["Designing the investigation", "Enacting the investigation", "Reflecting on the investigation"].map((t, i) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          {me?.student && me.student.sessionStatus === "active" && <ContinueCard label={`Continue as ${me.student.name}`} sub={me.student.sessionTitle} href="/student" />}
          {me?.staff && <ContinueCard label={`Continue as ${me.staff.name}`} sub={me.staff.role === "teacher" ? "Teacher dashboard" : "Teacher Educator dashboard"} href={me.staff.role === "teacher" ? "/teacher" : "/educator"} />}
        </div>

        <div className="card self-center p-6 sm:p-8">
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist">
            {(["student", "staff"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-2 transition ${mode === m ? "bg-white text-blue-800 shadow" : "text-slate-500 hover:text-slate-800"}`}>
                {m === "student" ? "I’m a student" : "Teacher / Educator"}
              </button>
            ))}
          </div>
          {mode === "student" ? <StudentJoin /> : <StaffLogin />}
        </div>
      </div>
    </main>
  );
}

function ContinueCard({ label, sub, href }: { label: string; sub: string; href: string }) {
  return (
    <a href={href} className="mt-8 flex items-center justify-between rounded-2xl border border-blue-200 bg-white p-4 shadow-sm hover:border-blue-400">
      <span>
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
      <span className="text-xl text-blue-700">→</span>
    </a>
  );
}

function StudentJoin() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [name, setName] = useState("");
  const [cls, setCls] = useState("");
  const [classNo, setClassNo] = useState("");
  const [groupId, setGroupId] = useState<string>("auto");
  const [pin, setPin] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [waiting, setWaiting] = useState(false);

  async function findSession(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const l = await api<Lookup>("GET", `/join/${encodeURIComponent(code.trim())}`);
      setLookup(l);
    } catch (x) {
      setErr((x as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function join(e?: React.FormEvent) {
    e?.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("POST", "/student/join", { code, name, class: cls, classNo, groupId: groupId === "auto" ? "auto" : Number(groupId), pin });
      router.push("/student");
    } catch (x) {
      const a = x as ApiError;
      if (a.code === "pin_required") setNeedPin(true);
      if (a.code === "needs_approval") setWaiting(true);
      else setWaiting(false);
      setErr(a.message);
    } finally {
      setBusy(false);
    }
  }

  // While the teacher is approving this device, quietly retry.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => join(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  if (!lookup)
    return (
      <form onSubmit={findSession} className="space-y-4">
        <h2 className="text-xl font-bold">Join your session</h2>
        <Field label="Session join code" hint="Your teacher will show you a 6-letter code.">
          <input className="input text-center font-mono text-2xl uppercase tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} autoFocus required autoComplete="off" />
        </Field>
        {err && <p className="text-sm text-rose-700" role="alert">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || code.trim().length < 4}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    );

  const chosen = lookup.groups.find((g) => String(g.id) === groupId);
  return (
    <form onSubmit={join} className="space-y-4">
      <div>
        <button type="button" className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => { setLookup(null); setNeedPin(false); setWaiting(false); setErr(""); }}>
          ← Different code
        </button>
        <h2 className="mt-1 text-xl font-bold">{lookup.session.title}</h2>
      </div>
      <Field label="Your name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Class">
          <input className="input" value={cls} onChange={(e) => setCls(e.target.value)} placeholder="e.g. 8A" maxLength={20} required autoComplete="off" />
        </Field>
        <Field label="Class number">
          <input className="input" value={classNo} onChange={(e) => setClassNo(e.target.value)} placeholder="e.g. 12" maxLength={10} inputMode="numeric" required autoComplete="off" />
        </Field>
      </div>
      <Field label="Your group">
        <select className="input" value={groupId} onChange={(e) => { setGroupId(e.target.value); setNeedPin(false); }}>
          <option value="auto">Assign me to a group</option>
          {lookup.groups.map((g) => (
            <option key={g.id} value={g.id} disabled={g.seatsLeft === 0}>
              {g.name}
              {g.hasPin ? " 🔒" : ""}
              {g.seatsLeft !== null ? ` – ${g.seatsLeft} seat${g.seatsLeft === 1 ? "" : "s"} left` : ""}
            </option>
          ))}
        </select>
      </Field>
      {(needPin || chosen?.hasPin) && (
        <Field label="Group PIN" hint="Ask your teacher for your group’s PIN.">
          <input className="input font-mono" value={pin} onChange={(e) => setPin(e.target.value)} maxLength={12} autoComplete="off" />
        </Field>
      )}
      {err && (
        <p className={`rounded-lg p-3 text-sm ${waiting ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`} role="alert">
          {err}
          {waiting && <span className="mt-1 block text-xs">Waiting for approval… this page will continue automatically.</span>}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy && !waiting}>
        {busy ? "Joining…" : "Join session"}
      </button>
      <p className="text-center text-xs text-slate-500">Been here before? Enter the same name, class and number to carry on where you left off.</p>
    </form>
  );
}

function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<Demo[]>([]);
  useEffect(() => {
    api<{ accounts: Demo[] }>("GET", "/auth/demo-accounts").then((d) => setDemo(d.accounts)).catch(() => {});
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ user: { role: string } }>("POST", "/auth/login", { email, password });
      router.push(r.user.role === "teacher" ? "/teacher" : "/educator");
    } catch (x) {
      setErr((x as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-bold">Staff sign in</h2>
      <Field label="Email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
      </Field>
      <Field label="Password">
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
      </Field>
      {err && <p className="text-sm text-rose-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {demo.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <summary className="cursor-pointer font-semibold">Test accounts (for testing only)</summary>
          <ul className="mt-2 space-y-1.5">
            {demo.map((d) => (
              <li key={d.email} className="flex items-center justify-between gap-2">
                <span>
                  <b>{d.name}</b>
                  <br />
                  <span className="font-mono">{d.email}</span>
                </span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setEmail(d.email); setPassword(d.password); }}>
                  Fill
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}
