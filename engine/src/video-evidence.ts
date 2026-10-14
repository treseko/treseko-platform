import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type Recording = { id: string; directory: string; temporary: boolean; expires_at: string | null; created_at: string };
export type VideoReference = { id: string; temporary: boolean; expires_at: string | null; size_bytes: number; page_count: number; content_type: 'video/webm' };

export class VideoEvidenceStore {
  private active = new Set<string>();
  constructor(public root: string, private policy = {
    dryRunTtlMs: Number(process.env.AI_DRY_RUN_VIDEO_TTL_HOURS || 24) * 3600000,
    dryRunMaxBytes: Number(process.env.AI_DRY_RUN_VIDEO_MAX_MB || 512) * 1048576,
    reserveBytes: Number(process.env.AI_VIDEO_DISK_RESERVE_MB || 512) * 1048576,
  }) {
    for (const value of Object.values(policy)) if (!Number.isFinite(value) || value < 0) throw new Error('Invalid video retention policy');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  begin(temporary: boolean): Recording {
    this.cleanup();
    const disk = fs.statfsSync(this.root);
    if (disk.bavail * disk.bsize < this.policy.reserveBytes + 128 * 1048576) throw new Error('Video storage reserve reached');
    const regularMax = Number(process.env.AI_VIDEO_REGULAR_MAX_MB || 10240) * 1048576;
    const used = this.manifests().filter(item => !item.temporary).reduce((sum, item) => sum + (item.size_bytes || 0), 0);
    if (!temporary && used >= regularMax) throw new Error('Regular video quota reached');
    const id = randomUUID();
    const recording = { id, directory: path.join(this.root, id), temporary,
      expires_at: temporary ? new Date(Date.now() + this.policy.dryRunTtlMs).toISOString() : null,
      created_at: new Date().toISOString() };
    fs.mkdirSync(recording.directory, { mode: 0o700 });
    fs.writeFileSync(path.join(recording.directory, 'manifest.json'), JSON.stringify({ ...recording, directory: undefined, state: 'recording' }), { mode: 0o600 });
    this.active.add(id);
    return recording;
  }

  async finish(recording: Recording, primaryPath?: string): Promise<VideoReference | null> {
    this.active.delete(recording.id);
    const files = fs.readdirSync(recording.directory).filter(file => file.endsWith('.webm'));
    const paths = files.map(file => path.join(recording.directory, file));
    if (primaryPath && paths.includes(primaryPath)) paths.sort((a, b) => a === primaryPath ? -1 : b === primaryPath ? 1 : 0);
    const total = paths.reduce((sum, file) => sum + fs.statSync(file).size, 0);
    if (!paths.length || paths.length > 100 || total === 0 || total > 128 * 1048576) {
      fs.rmSync(recording.directory, { recursive: true, force: true });
      return null;
    }
    // Preserve popup recordings under the same execution reference.
    paths.forEach((file, index) => fs.renameSync(file, path.join(recording.directory, index === 0 ? 'video.webm' : `page-${index}.webm`)));
    const size_bytes = total;
    const reference: VideoReference = { id: recording.id, temporary: recording.temporary,
      expires_at: recording.temporary ? new Date(Date.now() + this.policy.dryRunTtlMs).toISOString() : null,
      size_bytes, page_count: paths.length, content_type: 'video/webm' };
    fs.writeFileSync(path.join(recording.directory, 'manifest.json'), JSON.stringify({ ...reference, created_at: recording.created_at, state: 'finished' }), { mode: 0o600 });
    this.cleanup();
    return this.resolve(recording.id) ? reference : null;
  }

  private manifests(): any[] {
    return fs.readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => {
      try { return [{ ...JSON.parse(fs.readFileSync(path.join(this.root, id, 'manifest.json'), 'utf8')), id }]; }
      catch { return []; }
    });
  }

  cleanup(now = Date.now()): void {
    const finished: any[] = [];
    for (const item of this.manifests()) {
      if (this.active.has(item.id)) continue;
      const orphan = item.state === 'recording' && now - Date.parse(item.created_at) > 3600000;
      if (orphan || (item.temporary && Date.parse(item.expires_at) <= now)) {
        fs.rmSync(path.join(this.root, item.id), { recursive: true, force: true });
      } else if (item.temporary && item.state === 'finished') finished.push(item);
    }
    finished.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    let total = finished.reduce((sum, item) => sum + item.size_bytes, 0);
    for (const item of finished) {
      if (total <= this.policy.dryRunMaxBytes) break;
      fs.rmSync(path.join(this.root, item.id), { recursive: true, force: true });
      total -= item.size_bytes;
    }
  }

  deleteTemporary(id: string): boolean {
    if (!/^[a-f0-9-]{36}$/.test(id) || this.active.has(id)) return false;
    const directory = path.join(this.root, id);
    if (!fs.existsSync(directory)) return true;
    if (fs.lstatSync(directory).isSymbolicLink()) return false;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.temporary !== true || manifest.state !== 'finished') return false;
    fs.rmSync(directory, { recursive: true, force: true });
    return true;
  }

  resolve(id: string, page = 0): string | null {
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isInteger(page) || page < 0 || page >= 100) return null;
    try {
      const directory = path.join(this.root, id);
      if (fs.lstatSync(directory).isSymbolicLink()) return null;
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      if (manifest.state !== 'finished' || (manifest.temporary && Date.parse(manifest.expires_at) <= Date.now())) return null;
      if (page >= (manifest.page_count || 1)) return null;
      const video = path.join(directory, page === 0 ? 'video.webm' : `page-${page}.webm`);
      return fs.lstatSync(video).isFile() && !fs.lstatSync(video).isSymbolicLink() ? video : null;
    } catch { return null; }
  }
}

let instance: VideoEvidenceStore | undefined;
export const videoEvidenceStore = () => instance ||= new VideoEvidenceStore(path.resolve(process.env.AI_VIDEO_DIR || 'videos'));
