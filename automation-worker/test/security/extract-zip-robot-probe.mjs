import readline from "node:readline";
import { acceptNormalArchive, cleanupArchiveCorpus, rejectEntryTraversal, rejectPreexistingSymlink, rejectSymlinkTraversal } from "./extract-zip-probe.mjs";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { kind, index } = JSON.parse(line);
    const passed = kind === "safe" ? await acceptNormalArchive(index) : kind === "traversal" ? await rejectEntryTraversal(index) : kind === "preexisting" ? await rejectPreexistingSymlink(index) : await rejectSymlinkTraversal(index);
    process.stdout.write(`${JSON.stringify({ passed })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
cleanupArchiveCorpus();
