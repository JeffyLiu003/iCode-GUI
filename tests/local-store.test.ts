import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../src/main/local-store';
import { Controller } from '../src/main/controller';
test('本地会话原子落盘，重新打开可恢复草稿与记录', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'icode-store-')); const file = join(dir, 'history.json');
 try {
  const store = new LocalStore(file); const c = new Controller(() => {}, () => store.schedule(() => c.exportData()));
  await c.project(dir); await c.command({ type: 'connect', mode: 'demo', executable: 'icode' });
  await c.command({ type: 'draft', id: c.active().id, text: '落盘草稿' }); store.flush();
  const restored = new Controller(() => {}); restored.restore(new LocalStore(file).read()!);
  assert.equal(restored.active().draft, '落盘草稿'); assert.ok(!readdirSync(dir).includes('history.json.tmp'));
  await c.close(); await restored.close();
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('损坏的历史文件备份后才允许写入，新记录不覆盖唯一副本', () => {
 const dir = mkdtempSync(join(tmpdir(), 'icode-store-')); const file = join(dir, 'history.json');
 try {
  writeFileSync(file, 'broken json'); const errors: string[] = []; const store = new LocalStore(file, e => errors.push(e));
  assert.equal(store.read(), undefined); assert.ok(errors.length > 0);
  const backup = readdirSync(dir).find(n => n.endsWith('.bak'))!; assert.equal(readFileSync(join(dir, backup), 'utf8'), 'broken json');
  store.schedule(() => new Controller(() => {}).exportData()); store.flush(); assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
