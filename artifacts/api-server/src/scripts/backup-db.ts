/**
 * R3: Database backup to App Storage.
 *
 * Runs `pg_dump` against $DATABASE_URL, gzips the output, uploads to the
 * default App Storage bucket under `<PRIVATE_OBJECT_DIR>/backups/`, then
 * prunes objects older than RETENTION_DAYS (default 30).
 *
 * Run locally:   pnpm --filter @workspace/api-server backup
 * Run on cron:   configure a Replit Scheduled Deployment that invokes
 *                `node ./dist/scripts/backup-db.js` once per day.
 *
 * Required env: DATABASE_URL, DEFAULT_OBJECT_STORAGE_BUCKET_ID,
 *               PRIVATE_OBJECT_DIR.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { objectStorageClient } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const RETENTION_DAYS = Number(process.env["BACKUP_RETENTION_DAYS"] || 30);

function parseObjectDir(): { bucket: string; prefix: string } {
  const dir = process.env["PRIVATE_OBJECT_DIR"];
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not set");
  // Format: /<bucket>/<prefix>
  const trimmed = dir.replace(/^\/+/, "").replace(/\/+$/, "");
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucket: trimmed, prefix: "" };
  return { bucket: trimmed.slice(0, slash), prefix: trimmed.slice(slash + 1) };
}

async function runPgDump(target: string): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "pg_dump",
      [
        "--no-owner",
        "--no-privileges",
        "--format=plain",
        "--encoding=UTF8",
        url,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const out = createWriteStream(target);
    proc.stdout.pipe(out);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += String(chunk)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function gzipFile(src: string, dest: string): Promise<void> {
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dest));
}

async function pruneOldBackups(bucketName: string, prefix: string): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const [files] = await objectStorageClient.bucket(bucketName).getFiles({ prefix });
  let pruned = 0;
  for (const f of files) {
    const updated = f.metadata?.updated ? Date.parse(String(f.metadata.updated)) : NaN;
    if (!Number.isNaN(updated) && updated < cutoff) {
      try {
        await f.delete();
        pruned++;
      } catch (err) {
        logger.warn({ err: (err as Error).message, name: f.name }, "backup_prune_failed");
      }
    }
  }
  return pruned;
}

async function main(): Promise<void> {
  const { bucket, prefix } = parseObjectDir();
  const isoDate = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpSql = join(tmpdir(), `pgdump-${isoDate}.sql`);
  const tmpGz = `${tmpSql}.gz`;
  const objectName = `${prefix ? prefix + "/" : ""}backups/${isoDate}.sql.gz`;

  logger.info({ bucket, objectName }, "backup_started");
  try {
    await runPgDump(tmpSql);
    const sqlSize = statSync(tmpSql).size;
    await gzipFile(tmpSql, tmpGz);
    const gzSize = statSync(tmpGz).size;

    await objectStorageClient
      .bucket(bucket)
      .upload(tmpGz, {
        destination: objectName,
        contentType: "application/gzip",
        metadata: {
          metadata: {
            createdBy: "backup-db",
            sourceDatabaseSize: String(sqlSize),
            retentionDays: String(RETENTION_DAYS),
          },
        },
      });

    const pruned = await pruneOldBackups(bucket, `${prefix ? prefix + "/" : ""}backups/`);
    logger.info(
      { bucket, objectName, sqlSize, gzSize, pruned, retentionDays: RETENTION_DAYS },
      "backup_completed",
    );
  } finally {
    try { unlinkSync(tmpSql); } catch {}
    try { unlinkSync(tmpGz); } catch {}
  }
}

main().catch((err) => {
  logger.fatal({ err: { message: err?.message, stack: err?.stack } }, "backup_failed");
  process.exit(1);
});
