import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import extractZip from "extract-zip";

const require = createRequire(import.meta.url);
const browsersMain = require.resolve("@puppeteer/browsers");
const { unpackArchive } = require(path.join(path.dirname(browsersMain), "fileUtil.js"));
const count = 250;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-extract-zip-corpus-"));
const generator = String.raw`
import os, pathlib, stat, sys, zipfile
import warnings
warnings.filterwarnings("ignore", message="Duplicate name:.*")
root = pathlib.Path(sys.argv[1])
count = int(sys.argv[2])
for i in range(count):
    with zipfile.ZipFile(root / f"safe-{i}.zip", "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"payload-{i}.txt", f"safe archive {i}")
        z.writestr(f"duplicate-{i}.txt", "first regular entry")
        z.writestr(f"duplicate-{i}.txt", "second regular entry")
        if i % 2:
            target = f"target-{i}.txt"
            z.writestr(target, f"safe symlink target {i}")
            info = zipfile.ZipInfo(f"alias-{i}.txt")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info, target)
    outside = root / f"outside-{i}.txt"
    outside.write_text(f"original sentinel {i}")
    outside_entry = root / f"outside-entry-{i}.txt"
    outside_entry.write_text(f"original entry sentinel {i}")
    with zipfile.ZipFile(root / f"entry-traversal-{i}.zip", "w") as z:
        z.writestr(f"../outside-entry-{i}.txt", f"attacker entry {i}")
    link = f"link-{i}"
    info = zipfile.ZipInfo(link)
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(root / f"attack-{i}.zip", "w") as z:
        target = str(outside) if i % 2 == 0 else f"../outside-{i}.txt"
        z.writestr(info, target)
        # CVE-2026-19693: duplicate the entry name with a regular file. The
        # extractor checks the parent directory, then opens through the symlink.
        z.writestr(link, f"attacker payload {i}")
    with zipfile.ZipFile(root / f"preexisting-link-{i}.zip", "w") as z:
        z.writestr(f"preexisting-{i}.txt", f"attacker preexisting payload {i}")
`;
execFileSync("python3", ["-c", generator, root, String(count)]);

export async function acceptNormalArchive(index) {
  const destination = path.join(root, `safe-dest-${index}`);
  const archive = path.join(root, `safe-${index}.zip`);
  if (index % 4 >= 2) await unpackArchive(archive, destination);
  else await extractZip(archive, { dir: destination });
  if (fs.readFileSync(path.join(destination, `duplicate-${index}.txt`), "utf8") !== "second regular entry") return false;
  if (index % 2) {
    return fs.readFileSync(path.join(destination, `alias-${index}.txt`), "utf8") === `safe symlink target ${index}`;
  }
  return fs.readFileSync(path.join(destination, `payload-${index}.txt`), "utf8") === `safe archive ${index}`;
}

export async function rejectSymlinkTraversal(index) {
  const destination = path.join(root, `attack-dest-${index}`);
  const escaped = path.join(root, `outside-${index}.txt`);
  const original = `original sentinel ${index}`;
  try {
    await extractZip(path.join(root, `attack-${index}.zip`), { dir: destination });
  } catch {
    return fs.readFileSync(escaped, "utf8") === original;
  }
  return fs.readFileSync(escaped, "utf8") === original;
}

export async function rejectEntryTraversal(index) {
  const destination = path.join(root, `entry-traversal-dest-${index}`);
  const escaped = path.join(root, `outside-entry-${index}.txt`);
  const original = `original entry sentinel ${index}`;
  try {
    await extractZip(path.join(root, `entry-traversal-${index}.zip`), { dir: destination });
  } catch {
    return fs.readFileSync(escaped, "utf8") === original;
  }
  return fs.readFileSync(escaped, "utf8") === original;
}

export async function rejectPreexistingSymlink(index) {
  const destination = path.join(root, `preexisting-dest-${index}`);
  const escaped = path.join(root, `outside-${index}.txt`);
  const link = path.join(destination, `preexisting-${index}.txt`);
  const original = `original sentinel ${index}`;
  fs.mkdirSync(destination, { recursive: true });
  fs.symlinkSync(escaped, link);
  try {
    await extractZip(path.join(root, `preexisting-link-${index}.zip`), { dir: destination });
  } catch {
    return fs.readFileSync(escaped, "utf8") === original && fs.lstatSync(link).isSymbolicLink();
  }
  return fs.readFileSync(escaped, "utf8") === original && fs.lstatSync(link).isSymbolicLink();
}

export function cleanupArchiveCorpus() {
  fs.rmSync(root, { recursive: true, force: true });
}
