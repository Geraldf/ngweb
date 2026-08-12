import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const manifestPaths = ["package.json", "apps/api/package.json", "apps/web/package.json"];

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function writeJson(path, value) {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

const rootManifest = await readJson("package.json");
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(rootManifest.version);

if (!match) {
  throw new Error(`Expected a semantic version, received "${rootManifest.version}".`);
}

const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;

for (const path of manifestPaths) {
  const manifest = await readJson(path);
  manifest.version = nextVersion;
  await writeJson(path, manifest);
}

const lockfile = await readJson("package-lock.json");
lockfile.version = nextVersion;
lockfile.packages[""].version = nextVersion;
lockfile.packages["apps/api"].version = nextVersion;
lockfile.packages["apps/web"].version = nextVersion;
await writeJson("package-lock.json", lockfile);

process.stdout.write(`${nextVersion}\n`);
