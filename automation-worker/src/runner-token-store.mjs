/** Prefer the durable rotated token over a bootstrap token kept in the environment. */
export function readRunnerToken(fs, tokenPath, bootstrapToken = "") {
  try {
    if (fs.existsSync(tokenPath)) {
      const persisted = String(fs.readFileSync(tokenPath, "utf8") || "").trim();
      if (persisted) return persisted;
    }
  } catch {
    // Preserve the bootstrap fallback when the durable store is unavailable.
  }
  return String(bootstrapToken || "").trim();
}
