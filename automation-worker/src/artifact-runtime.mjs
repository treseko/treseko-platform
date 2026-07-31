export function createArtifactRuntime(deps) {
  const { fs, path, ARTIFACT_MAX_BYTES, ARTIFACT_EXTENSIONS } = deps;

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".txt") return "text/plain";
  if (ext === ".json") return "application/json";
  if (ext === ".csv") return "text/csv";
  if (ext === ".xml") return "application/xml";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".zip") return "application/zip";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".ppt") return "application/vnd.ms-powerpoint";
  if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "application/octet-stream";
}

function artifactFromBuffer({ filename, contentType = "image/png", buffer, type = "screenshot", stepNumber = null }) {
  if (!buffer?.length || buffer.length > ARTIFACT_MAX_BYTES) return null;
  return {
    type,
    filename,
    content_type: contentType,
    base64: Buffer.from(buffer).toString("base64"),
    step_number: stepNumber,
  };
}

function artifactFromFile(filePath, type = "screenshot") {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > ARTIFACT_MAX_BYTES) return null;
    return artifactFromBuffer({
      filename: path.basename(filePath),
      contentType: contentTypeForFile(filePath),
      buffer: fs.readFileSync(filePath),
      type,
    });
  } catch {
    return null;
  }
}

function collectArtifacts(rootDir) {
  const artifacts = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (entry.name === ".last-run.json") continue;
        const ext = path.extname(entry.name).toLowerCase();
        const artifactType = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)
          ? "screenshot"
          : ext === ".json" && entry.name.toLowerCase().includes("report")
            ? "report"
            : "evidence";
        const artifact = artifactFromFile(fullPath, artifactType);
        if (artifact) artifacts.push(artifact);
      }
    }
  };
  visit(rootDir);
  return artifacts;
}

  return { contentTypeForFile, artifactFromBuffer, artifactFromFile, collectArtifacts };
}
