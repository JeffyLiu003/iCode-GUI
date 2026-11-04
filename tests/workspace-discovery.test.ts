import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverICodeWorkspaces } from '../src/main/workspace-discovery';
test('只读发现 iCode 最近工作区及聊天索引，跳过无效目录并去重', async () => {
 const root = await mkdtemp('/private/tmp/icode-discovery-');
 try {
  const one = join(root, 'one'), two = join(root, 'two');
  await mkdir(one); await mkdir(two); await mkdir(join(root, 'sessions', '.cache'), { recursive: true });
  await writeFile(join(root, 'workspace_mru.json'), JSON.stringify({ paths: [{ path: one }, { path: '/missing/project' }, { path: 'relative' }] }));
  await writeFile(join(root, 'sessions', '.cache', 'session_catalog.json'), JSON.stringify({ sessions: { a: { meta: { kind: 'chat', primary_cwd: two } }, b: { meta: { kind: 'chat', primary_cwd: one } } } }));
  assert.deepEqual(await discoverICodeWorkspaces(root), [one, two]);
  await rm(join(root, 'workspace_mru.json')); await rm(join(root, 'sessions', '.cache'), { recursive: true });
  await mkdir(join(root, 'sessions', '123456789abc'));
  await writeFile(join(root, 'sessions', '123456789abc', 'session.json'), JSON.stringify({ meta: { kind: 'chat', primary_cwd: two } }));
  assert.deepEqual(await discoverICodeWorkspaces(root), [two]);
 } finally { await rm(root, { recursive: true, force: true }); }
});
