import { randomUUID } from "node:crypto";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readExisting(fs, file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("El archivo de identidad persistente del Worker no es un archivo regular.");
  }
  const id = String(fs.readFileSync(file, "utf8") || "").trim();
  if (!UUID_V4.test(id)) throw new Error("La identidad persistente del Worker no es válida; no se generará otra identidad automáticamente.");
  return id;
}

export function readOrCreateWorkerInstanceId({ fs, path, file, randomId = randomUUID }) {
  try {
    if (fs.existsSync(file)) return readExisting(fs, file);
    const id = randomId();
    if (!UUID_V4.test(id)) throw new Error("El generador devolvió una identidad inválida para el Worker.");
    try {
      fs.writeFileSync(file, `${id}\n`, { mode: 0o600, flag: "wx" });
      return id;
    } catch (error) {
      // A concurrent process may have created the shared identity first.
      if (error?.code === "EEXIST" && fs.existsSync(file)) return readExisting(fs, file);
      throw error;
    }
  } catch (error) {
    throw new Error(`No se pudo leer o guardar la identidad persistente del Worker en ${path.resolve(file)}: ${error.message}`, { cause: error });
  }
}
