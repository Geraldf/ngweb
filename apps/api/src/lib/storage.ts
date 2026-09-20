import { access, mkdir, readFile, writeFile } from "node:fs/promises";

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
  await writeFile(path, JSON.stringify(data, null, 2));
}

export async function ensureDir(directory: string) {
  await mkdir(directory, { recursive: true });
}
