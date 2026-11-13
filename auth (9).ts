import crypto from "node:crypto";
import { get, run, now, num } from "./db";

export const STAFF_COOKIE = "si_staff";
export const STUDENT_COOKIE = "si_student";
const STAFF_TTL = 1000 * 60 * 60 * 12;
const STUDENT_TTL = 1000 * 60 * 60 * 24 * 14;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${h}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, h] = stored.split("$");
  if (alg !== "scrypt" || !salt || !h) return false;
  const a = Buffer.from(h, "hex");
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function issueToken(kind: "staff" | "student", id: number): { token: string; maxAge: number } {
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = kind === "staff" ? STAFF_TTL : STUDENT_TTL;
  run(
    "INSERT INTO auth_tokens(token_hash,kind,user_id,student_id,expires_at) VALUES(?,?,?,?,?)",
    sha(token),
    kind,
    kind === "staff" ? id : null,
    kind === "student" ? id : null,
    now() + ttl
  );
  return { token, maxAge: Math.floor(ttl / 1000) };
}

export function revokeToken(token: string) {
  run("DELETE FROM auth_tokens WHERE token_hash=?", sha(token));
}
export function revokeStudentTokens(studentId: number) {
  run("DELETE FROM auth_tokens WHERE student_id=?", studentId);
}

function parseCookies(h: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  (h || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export interface StaffUser {
  id: number;
  role: "teacher" | "educator";
  name: string;
  email: string;
}
export interface Auth {
  staff?: StaffUser;
  studentId?: number;
  staffToken?: string;
  studentToken?: string;
}

export function getAuth(req: Request): Auth {
  const c = parseCookies(req.headers.get("cookie"));
  const auth: Auth = {};
  if (c[STAFF_COOKIE]) {
    const r = get(
      "SELECT u.id,u.role,u.name,u.email,t.expires_at FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='staff'",
      sha(c[STAFF_COOKIE])
    );
    if (r && num(r.expires_at) > now()) {
      auth.staff = { id: num(r.id), role: r.role as StaffUser["role"], name: String(r.name), email: String(r.email) };
      auth.staffToken = c[STAFF_COOKIE];
    }
  }
  if (c[STUDENT_COOKIE]) {
    const r = get("SELECT student_id,expires_at FROM auth_tokens WHERE token_hash=? AND kind='student'", sha(c[STUDENT_COOKIE]));
    if (r && num(r.expires_at) > now()) {
      auth.studentId = num(r.student_id);
      auth.studentToken = c[STUDENT_COOKIE];
    }
  }
  return auth;
}

export function cookieHeader(name: string, value: string, maxAge: number): string {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/* Tiny in-memory rate limiter (per process) for login / PIN guessing. */
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const t = now();
  const b = buckets.get(key);
  if (!b || b.reset < t) {
    buckets.set(key, { n: 1, reset: t + windowMs });
    return true;
  }
  b.n += 1;
  return b.n <= max;
}
export function rateLimitReset(key: string) {
  buckets.delete(key);
}
