export function getActiveEngineRelease({fs, path, pointerFile, releases}) {
  if (!fs.existsSync(pointerFile)) return null;
  const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[a-f0-9]{12}$/;
  if (pointer?.schema !== 1 || !releasePattern.test(pointer.release)
      || (pointer.previous_release != null && !releasePattern.test(pointer.previous_release))) {
    throw new Error('El puntero de la version activa del Engine no es valido.');
  }
  const base = fs.realpathSync(releases);
  const target = path.join(base, pointer.release);
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !fs.realpathSync(target).startsWith(`${base}${path.sep}`)) {
    throw new Error('La release activa del Engine no es segura.');
  }
  for (const required of ['package.json', 'package-lock.json', 'VERSION', 'src/server.ts', 'node_modules/tsx/dist/cli.mjs']) {
    const item = path.join(target, required);
    const metadata = fs.lstatSync(item);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('La release activa del Engine esta incompleta.');
  }
  return {
    release: pointer.release,
    path: target,
    version: fs.readFileSync(path.join(target, 'VERSION'), 'utf8').trim(),
    previous_release: pointer.previous_release || null,
  };
}

export function removeStaleEngineReleases({fs, path, releases}, active, previous) {
  if (!active) throw new Error('No se puede limpiar releases sin una release activa.');
  if (!fs.existsSync(releases)) return;
  for (const entry of fs.readdirSync(releases, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.stage-')
        || entry.name === '.treseko-remote-docker-backups'
        || entry.name === active || entry.name === previous) continue;
    fs.rmSync(path.join(releases, entry.name), {recursive: true, force: true});
  }
}
