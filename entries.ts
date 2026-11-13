import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { all, UPLOAD_DIR, num, type Row } from "./db";
import { bad } from "./router";
import { TAGS, LIMITS } from "./constants";

export interface TableData {
  columns: string[];
  rows: string[][];
}
export interface EntryDto {
  id: number;
  part: number;
  groupId: number;
  studentId: number;
  author: { name: string; class: string; classNo: string };
  tag: string | null;
  body: string;
  hasImage: boolean;
  table: TableData | null;
  createdAt: number;
  updatedAt: number;
}

const BASE =
  "SELECT e.*, s.name AS s_name, s.class AS s_class, s.class_no AS s_class_no FROM entries e JOIN students s ON s.id=e.student_id WHERE e.deleted_at IS NULL";

export function toDto(r: Row): EntryDto {
  return {
    id: num(r.id),
    part: num(r.part),
    groupId: num(r.group_id),
    studentId: num(r.student_id),
    author: { name: String(r.s_name), class: String(r.s_class), classNo: String(r.s_class_no) },
    tag: (r.tag as string) || null,
    body: String(r.body),
    hasImage: !!r.image_file,
    table: r.table_json ? (JSON.parse(String(r.table_json)) as TableData) : null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function entriesWhere(where: string, ...params: unknown[]): EntryDto[] {
  return all(`${BASE} AND ${where} ORDER BY e.created_at, e.id`, ...params).map(toDto);
}

export function validateTag(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !(TAGS as readonly string[]).includes(v)) throw bad("Unknown tag");
  return v;
}

export function validateTable(v: unknown): TableData | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") throw bad("Invalid data table");
  const t = v as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(t.columns) || !Array.isArray(t.rows)) throw bad("Invalid data table");
  if (t.columns.length < 1 || t.columns.length > LIMITS.tableMaxCols) throw bad(`A data table can have 1 to ${LIMITS.tableMaxCols} columns`);
  if (t.rows.length > LIMITS.tableMaxRows) throw bad(`A data table can have at most ${LIMITS.tableMaxRows} rows`);
  const cell = (c: unknown) => {
    if (c === null || c === undefined) return "";
    if (typeof c !== "string" && typeof c !== "number") throw bad("Table cells must be text or numbers");
    const s = String(c);
    if (s.length > LIMITS.cellMax) throw bad(`Table cell too long (max ${LIMITS.cellMax})`);
    return s;
  };
  const columns = t.columns.map(cell);
  const rows = t.rows.map((r) => {
    if (!Array.isArray(r)) throw bad("Invalid data table");
    const out = r.slice(0, columns.length).map(cell);
    while (out.length < columns.length) out.push("");
    return out;
  });
  return { columns, rows };
}

const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: "png", test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", test: (b) => b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];
export const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** Accepts a data URL, checks size and real file signature (never trusts the declared type), stores it on disk. */
export function saveImage(dataUrl: unknown): string {
  if (typeof dataUrl !== "string") throw bad("Invalid image");
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw bad("Images must be PNG, JPEG or WebP");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > LIMITS.imageMaxBytes) throw bad("Image is too large (max 3 MB). Try a smaller photo.");
  const kind = MAGIC.find((k) => k.test(buf));
  if (!kind) throw bad("That file is not a valid PNG, JPEG or WebP image");
  const name = `${crypto.randomUUID()}.${kind.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}
export function deleteImageFile(name: string | null | undefined) {
  if (!name || !/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name)) return;
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, name));
  } catch {
    /* already gone */
  }
}
export function readImage(name: string): { data: Buffer; mime: string } | null {
  if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name)) return null;
  try {
    const data = fs.readFileSync(path.join(UPLOAD_DIR, name));
    return { data, mime: MIME[name.split(".").pop()!] };
  } catch {
    return null;
  }
}
