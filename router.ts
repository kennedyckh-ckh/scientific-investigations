import { getAuth, cookieHeader, type Auth } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code);
  }
}
export const bad = (message: string, code = "bad_request") => new HttpError(400, code, message);
export const forbidden = (message = "You do not have access to this.", code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);

export interface Ctx {
  req: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  auth: Auth;
  ip: string;
  setCookie: (name: string, value: string, maxAge: number) => void;
}

export type Handler = (ctx: Ctx) => unknown | Response | Promise<unknown | Response>;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}
const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "/?$"
  );
  routes.push({ method, re, keys, handler });
}

export async function dispatch(req: Request, pathname: string): Promise<Response> {
  const method = req.method.toUpperCase();
  const headers = new Headers({ "Cache-Control": "no-store" });
  const json = (status: number, data: unknown) => {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(data), { status, headers });
  };
  try {
    let matched: Route | undefined;
    let params: Record<string, string> = {};
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      matched = r;
      params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      break;
    }
    if (!matched) return json(pathMatched ? 405 : 404, { error: pathMatched ? "method_not_allowed" : "not_found", message: "No such endpoint" });

    let body: unknown = undefined;
    if (method !== "GET" && method !== "HEAD") {
      // JSON-only mutations: a cross-site form post cannot send this content type, which blocks CSRF.
      const ct = req.headers.get("content-type") || "";
      if (!ct.toLowerCase().startsWith("application/json")) throw new HttpError(415, "unsupported_media_type", "JSON required");
      const text = await req.text();
      if (text.length > 6 * 1024 * 1024) throw new HttpError(413, "too_large", "Request too large");
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw bad("Invalid JSON");
      }
    }
    const ctx: Ctx = {
      req,
      params,
      query: new URL(req.url).searchParams,
      body,
      auth: getAuth(req),
      ip: (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim(),
      setCookie: (n, v, a) => headers.append("Set-Cookie", cookieHeader(n, v, a)),
    };
    const out = await matched.handler(ctx);
    if (out instanceof Response) {
      headers.forEach((v, k) => k.toLowerCase() === "set-cookie" ? out.headers.append(k, v) : out.headers.set(k, v));
      return out;
    }
    return json(200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
    console.error("API error", e);
    return json(500, { error: "server_error", message: "Something went wrong on the server. Your work was not lost; please try again." });
  }
}

/* ---------- validation helpers ---------- */
export function str(v: unknown, max: number, field: string, opts: { min?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    throw bad(`${field} is required`);
  }
  if (typeof v !== "string") throw bad(`${field} must be text`);
  const s = v.trim();
  if (s.length < (opts.min ?? (opts.optional ? 0 : 1))) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters)`);
  return s;
}
export function int(v: unknown, field: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) throw bad(`${field} must be a whole number`);
  return n;
}
export function partNo(v: unknown): 1 | 2 | 3 {
  const n = int(v, "part");
  if (n !== 1 && n !== 2 && n !== 3) throw bad("part must be 1, 2 or 3");
  return n;
}
export function safeLink(v: unknown): string {
  const s = str(v, 500, "Web link", { optional: true });
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return u.toString();
  } catch {
    throw bad("Web link must start with http:// or https://");
  }
}
