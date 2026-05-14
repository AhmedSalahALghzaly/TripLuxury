/**
 * R3: Database restore from an App Storage backup.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server restore -- list
 *     → prints all available backup objects (newest first).
 *
 *   pnpm --filter @workspace/api-server restore -- <objectName> --confirm
 *     → downloads, gunzips, pipes into psql against $DATABASE_URL.
 *
 * The --confirm flag is mandatory because restore is destructive: it runs
 * the dump against the live $DATABASE_URL and will overwrite or duplicate
 * existing data depending on the dump format.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { objectStorageClient } from "../lib/objectStorage";
import { logger } from "../lib/logger";

function parseObjectDir(): { bucket: string; prefix: string } {
  const dir = process.env["PRIVATE_OBJECT_DIR"];
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not set");
  const trimmed = dir.replace(/^\/+/, "").replace(/\/+$/, "");
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucket: trimmed, prefix: "" };
  return { bucket: trimmed.slice(0, slash), prefix: trimmed.slice(slash + 1) };
}

async function listBackups(): Promise<void> {
  const { bucket, prefix } = parseObjectDir();
  const fullPrefix = `${prefix ? prefix + "/" : ""}backups/`;
  const [files] = await objectStorageClient.bucket(bucket).getFiles({ prefix: fullPrefix });
  const sorted = files
    .map((f) => ({
      name: f.name,
      size: Number(f.metadata?.size ?? 0),
      updated: String(f.metadata?.updated ?? ""),
    }))
    .sort((a, b) => b.updated.localeCompare(a.updated));
  if (sorted.length === 0) {
    console.log("No backups found.");
    return;
  }
  console.log(`Found ${sorted.length} backup(s):`);
  for (const f of sorted) {
    const mb = (f.size / 1024 / 1024).toFixed(2);
    console.log(`  ${f.updated}  ${mb} MB  ${f.name}`);
  }
}

async function runPsqlRestore(sqlPath: string): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("psql", ["-v", "ON_ERROR_STOP=1", url, "-f", sqlPath], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited with code ${code}`));
    });
  });
}

async function restore(objectName: string): Promise<void> {
  const { bucket } = parseObjectDir();
  const tmpGz = join(tmpdir(), `restore-${Date.now()}.sql.gz`);
  const tmpSql = tmpGz.replace(/\.gz$/, "");

  logger.info({ bucket, objectName }, "restore_download_started");
  await objectStorageClient.bucket(bucket).file(objectName).download({ destination: tmpGz });
  const downloadedBytes = statSync(tmpGz).size;
  logger.info({ downloadedBytes }, "restore_download_completed");

  await pipeline(createReadStream(tmpGz), createGunzip(), createWriteStream(tmpSql));
  const sqlBytes = statSync(tmpSql).size;
  logger.info({ sqlBytes }, "restore_extracted");

  try {
    await runPsqlRestore(tmpSql);
    logger.info({ objectName }, "restore_completed");
  } finally {
    try { unlinkSync(tmpGz); } catch {}
    try { unlinkSync(tmpSql); } catch {}
  }
}

async function main(): Promise<void> {
  // Filter out the `--` separator pnpm sometimes forwards from `pnpm run X -- args`.
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.length === 0 || args[0] === "list") {
    await listBackups();
    return;
  }
  const objectName = args[0]!;
  const confirmed = args.includes("--confirm");
  if (!confirmed) {
    console.error("Refusing to restore without --confirm flag.");
    console.error("Re-run as:  restore-db <objectName> --confirm");
    process.exit(2);
  }
  await restore(objectName);
}

main().catch((err) => {
  logger.fatal({ err: { message: err?.message, stack: err?.stack } }, "restore_failed");
  process.exit(1);
});
