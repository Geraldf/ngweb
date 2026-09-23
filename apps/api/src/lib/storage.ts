import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";

export async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJSON(path: string, data: unknown) {
  await mkdir(path.substring(0, path.lastIndexOf("/")), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2));
  // rename() is atomic on POSIX: a crash can never leave the target file
  // truncated and concurrent readers never observe a half-written file.
  await rename(tempPath, path);
}

export async function ensureDir(directory: string) {
  await mkdir(directory, { recursive: true });
}

// --- Concurrency lock ---
// Single-process mutex to serialize read-modify-write on JSON files.
// Prevents lost writes when concurrent requests interleave read-modify-write.

type Release = () => void;

const lockQueues = new Map<string, Promise<void>>();

export async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = lockQueues.get(path) ?? Promise.resolve();

  let release: Release;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  lockQueues.set(path, next);

  await prev;

  try {
    return await fn();
  } finally {
    release!();
    if (lockQueues.get(path) === next) {
      lockQueues.delete(path);
    }
  }
}
