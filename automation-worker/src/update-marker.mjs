import fs from "node:fs";
import path from "node:path";

// La marca de reinicio la escribe el backend al aplicar el paquete de update.
// El worker debe poder consumirla aunque la API no responda: durante la
// aplicacion el backend sigue caido, y atar el consumo a un heartbeat exitoso
// deja la marca sin consumir y la actualizacion sin converger. Se consulta en
// cada vuelta del bucle principal, no solo tras un heartbeat.
export function createUpdateMarker({
  directory,
  getActiveJobs,
  deps = {},
}) {
  if (!path.isAbsolute(directory)) {
    throw new Error("Se requiere una ruta absoluta para el directorio de update");
  }
  const restartPath = path.join(directory, ".treseko-update-restart");
  const rollbackPath = path.join(directory, ".treseko-update-rollback");
  const exists = deps.existsSync ?? fs.existsSync;
  const unlink = deps.unlinkSync ?? fs.unlinkSync;
  const exit = deps.exit ?? (code => process.exit(code));
  const log = deps.log ?? console;

  function consumeIfReady() {
    if (getActiveJobs() > 0 || exists(rollbackPath) || !exists(restartPath)) {
      return false;
    }
    log.info("Actualizacion del worker lista; reiniciando el proceso para cargarla.");
    try {
      unlink(restartPath);
    } catch (error) {
      log.error(
        "No se pudo consumir la marca de actualizacion del worker:",
        error?.message || error,
      );
      return false;
    }
    exit(0);
    return true;
  }

  return { restartPath, rollbackPath, consumeIfReady };
}
