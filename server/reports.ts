// بلاغات اللاعبين المسيئين: تُحفظ بأقل قدر من البيانات (لا صوت، لا عناوين IP).
// افتراضيًا في ملف JSONL محلي؛ وإذا ضُبط DATABASE_URL تُحفظ في PostgreSQL.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface Report {
  at: string;
  room: string;
  reporterId: string;
  reporterName: string;
  targetId: string;
  targetName: string;
  reason: string;
}

export interface ReportStore {
  add(r: Report): Promise<void>;
}

export function fileReportStore(file: string): ReportStore {
  let ready: Promise<unknown> | null = null;
  return {
    async add(r) {
      ready ??= mkdir(dirname(file), { recursive: true });
      await ready;
      await appendFile(file, JSON.stringify(r) + "\n", "utf8");
    },
  };
}

/** تخزين اختياري في PostgreSQL (يحتاج تثبيت الحزمة pg وضبط DATABASE_URL) */
export async function pgReportStore(url: string): Promise<ReportStore> {
  const mod = (await import(/* @vite-ignore */ "pg" as string)) as { default: { Pool: new (o: { connectionString: string }) => PgPool } };
  const pool = new mod.default.Pool({ connectionString: url });
  await pool.query(`create table if not exists reports (
    id bigserial primary key,
    at timestamptz not null,
    room text not null,
    reporter_id text not null,
    reporter_name text not null,
    target_id text not null,
    target_name text not null,
    reason text not null
  )`);
  return {
    async add(r) {
      await pool.query("insert into reports (at, room, reporter_id, reporter_name, target_id, target_name, reason) values ($1,$2,$3,$4,$5,$6,$7)", [
        r.at,
        r.room,
        r.reporterId,
        r.reporterName,
        r.targetId,
        r.targetName,
        r.reason,
      ]);
    },
  };
}

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export function memoryReportStore(): ReportStore & { items: Report[] } {
  const items: Report[] = [];
  return {
    items,
    async add(r) {
      items.push(r);
    },
  };
}
