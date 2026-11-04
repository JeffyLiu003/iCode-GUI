import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

// Discover paths only. ACP remains authoritative for sessions and history.
export async function discoverICodeWorkspaces(configDir = process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'chrys') : join(homedir(), '.chrys')): Promise<string[]> {
  const paths = new Set<string>();
  const add = (value: unknown) => { if (typeof value === 'string' && isAbsolute(value)) paths.add(value); };
  const read = async (file: string) => { try { if ((await stat(file)).size > 32 * 1024 * 1024) return null; return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
  const mru = await read(join(configDir, 'workspace_mru.json'));
  for (const entry of Array.isArray(mru?.paths) ? mru.paths : []) add(entry?.path);
  const catalog = await read(join(configDir, 'sessions', '.cache', 'session_catalog.json'));
  for (const entry of Object.values(catalog?.sessions ?? {}) as any[]) if (entry?.meta?.kind === 'chat') add(entry.meta.primary_cwd);
  if (!paths.size) {
    const entries = await readdir(join(configDir, 'sessions'), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9-]{8,36}$/i.test(entry.name)) {
      const session = await read(join(configDir, 'sessions', entry.name, 'session.json'));
      if (session?.meta?.kind === 'chat') add(session.meta.primary_cwd);
    }
  }
  const existing: string[] = [];
  for (const path of paths) if (await stat(path).then(s => s.isDirectory()).catch(() => false)) existing.push(path);
  return existing;
}
