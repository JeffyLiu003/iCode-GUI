import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import type { SavedData } from '../shared/types';
export class LocalStore {
  private timer?: ReturnType<typeof setTimeout>;
  private blocked = false;
  private snapshot?: () => SavedData;
  constructor(private path: string, private onError: (message: string) => void = () => {}) {}
  read(): SavedData | undefined {
    if (!existsSync(this.path)) return;
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.buckets) || !Array.isArray(value.workspaces)) throw new Error('会话存储版本或结构不受支持');
      return value;
    } catch (error) {
      // Keep the original data before allowing any subsequent write.
      try { copyFileSync(this.path, this.path + `.unreadable-${Date.now()}.bak`); }
      catch { this.blocked = true; this.onError('历史文件读取与备份失败，已停止覆盖该文件；请检查目录权限。'); return; }
      this.onError(`本地历史未能加载，原文件已备份：${String(error)}`); return;
    }
  }
  schedule(snapshot: () => SavedData) {
    this.snapshot = snapshot;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 250);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (!this.snapshot || this.blocked) return;
    try { writeFileSync(this.path + '.tmp', JSON.stringify(this.snapshot()), { mode: 0o600 }); renameSync(this.path + '.tmp', this.path); }
    catch (error) { this.onError(`会话保存失败：${String(error)}`); }
  }
}
