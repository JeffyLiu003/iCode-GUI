import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Controller } from '../src/main/controller';
import { validateCommand } from '../src/shared/validation';
const waitFor = async (condition: () => boolean) => { const limit = Date.now() + 4000; while (!condition()) { if (Date.now() > limit) throw new Error('等待条件超时'); await new Promise(r => setTimeout(r, 10)); } };
async function demo() { const c = new Controller(() => {}); await c.project(process.cwd()); await c.command({ type: 'connect', mode: 'demo', executable: 'icode' }); return c; }
test('拒绝未知 IPC、超长请求和无效批次答案', () => {
 assert.throws(() => validateCommand({ type: 'approvalMode', mode: 'invalid' }));
 assert.throws(() => validateCommand({ type: 'connect', mode: 'live', executable: 'icode', approvalMode: 'invalid' }));
 assert.throws(() => validateCommand({ type: 'execute', shell: 'echo' }));
 assert.throws(() => validateCommand({ type: 'prompt', text: 'a'.repeat(100001) }));
 assert.throws(() => validateCommand({ type: 'answer', id: 'a', answers: [[1]] }));
});
test('演示审批通过后产生模拟 Diff，且项目不会被写入', async () => {
 const c = await demo();
 const run = c.command({ type: 'prompt', text: '你好' });
 await waitFor(() => c.active().permissions.length > 0);
 await assert.rejects(c.command({ type: 'prompt', text: '重复请求' }));
 await assert.rejects(c.command({ type: 'approvalMode', mode: 'bypass' }));
 await c.command({ type: 'permission', id: c.active().permissions[0].id, optionId: 'allow' }); await run;
 assert.equal(c.active().phase, 'completed'); assert.equal(c.state.diffs[0].path, 'demo/welcome.ts');
 await c.close();
});
test('等待审批时取消，释放回调且不继续产生变更', async () => {
 const c = await demo(); const run = c.command({ type: 'prompt', text: '停止' });
 await waitFor(() => c.active().permissions.length > 0); const id = c.active().permissions[0].id;
 await c.command({ type: 'cancel' }); await run;
 assert.equal(c.active().phase, 'cancelled'); assert.equal(c.state.diffs.length, 0); assert.equal(c.active().permissions.length, 0);
 await assert.rejects(c.command({ type: 'permission', id, optionId: 'allow' })); await c.close();
});
test('真实 SDK + stdio 子进程：拆包、流式、反向审批、批次追问、扩展 Diff 与历史恢复', async () => {
 const c = new Controller(() => {}); await c.project(process.cwd());
 try {
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  assert.equal(c.state.runtimeVersion, 'fixture-1');
  const run = c.command({ type: 'prompt', text: 'test' });
  await waitFor(() => c.active().permissions.length > 0);
  assert.equal(c.active().messages.filter(m => m.role === 'assistant')[0].text, '你好，ACP');
  await c.command({ type: 'permission', id: c.active().permissions[0].id, optionId: 'allow' });
  await waitFor(() => c.active().questions.length > 0);
  await c.command({ type: 'answer', id: c.active().questions[0].id, answers: [['hello']] }); await run;
  assert.equal(c.active().phase, 'completed'); assert.equal(c.state.diffs[0].after, 'hello\n');
  await c.command({ type: 'approvalMode', mode: 'auto' }); assert.equal(c.active().approvalMode, 'auto');
  await c.command({ type: 'selectSession', id: 'history' }); assert.equal(c.state.approvalMode, 'manual'); assert.equal(c.active().messages[0].text, '恢复的消息');
  await c.command({ type: 'selectSession', id: 'history' }); assert.equal(c.active().messages.length, 1);
 } finally { await c.close(); }
});
test('找不到运行时时产生可诊断错误而非静默演示', async () => {
 const c = new Controller(() => {}); await c.project(process.cwd());
 await assert.rejects(c.command({ type: 'connect', mode: 'live', executable: '/nonexistent/icode' }));
 assert.equal(c.state.connection, 'error'); assert.match(c.state.error, /找不到/); assert.equal(c.state.mode, 'live'); await c.close();
});

test('演示模式支持免审批并保持每个会话独立设置', async () => {
 const c = await demo(); const firstId = c.active().id;
 await c.command({ type: 'approvalMode', mode: 'bypass' });
 await c.command({ type: 'prompt', text: '免审批任务' });
 assert.equal(c.active().phase, 'completed'); assert.equal(c.active().permissions.length, 0); assert.equal(c.state.diffs.length, 1);
 await c.command({ type: 'newSession' });
 await c.command({ type: 'approvalMode', mode: 'auto' });
 await c.command({ type: 'selectSession', id: firstId }); assert.equal(c.state.approvalMode, 'bypass');
 await c.close();
});
test('真实连接把选择的审批模式传入启动参数', async () => {
 const c = new Controller(() => {}); await c.project(process.cwd());
 try { await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs'), approvalMode: 'bypass' }); assert.equal(c.active().approvalMode, 'bypass'); }
 finally { await c.close(); }
});

test('会话增改、归档、置顶、草稿、工作区折叠和切换可完整持久恢复', async () => {
 const c = await demo(); const first = c.active().id;
 await c.command({ type: 'renameSession', id: first, title: '我的研发任务' });
 await c.command({ type: 'pinSession', id: first, pinned: true });
 await c.command({ type: 'draft', id: first, text: '尚未发送的需求' });
 await c.command({ type: 'archiveSession', id: first, archived: true });
 await assert.rejects(c.command({ type: 'prompt', text: '归档后不能执行' }));
 await c.command({ type: 'newSession' }); const second = c.active().id; assert.notEqual(first, second);
 await c.command({ type: 'collapseWorkspace', path: process.cwd(), collapsed: true });
 await c.project(resolve('tests'));
 await c.command({ type: 'connect', mode: 'demo', executable: 'icode' });
 assert.equal(c.state.sessions.length, 1); assert.notEqual(c.active().id, first);
 await c.command({ type: 'workspace', path: process.cwd() });
 assert.equal(c.state.connection, 'disconnected'); assert.equal(c.state.sessions.length, 2);
 await c.command({ type: 'selectSession', id: first }); assert.equal(c.active().draft, '尚未发送的需求');
 const saved = c.exportData(); const restored = new Controller(() => {}); restored.restore(saved);
 assert.equal(restored.active().customTitle, '我的研发任务'); assert.equal(restored.active().pinned, true); assert.equal(restored.active().archived, true); assert.equal(restored.state.workspaces[0].collapsed, true);
 await restored.command({ type: 'archiveSession', id: first, archived: false });
 await restored.command({ type: 'deleteSession', id: first }); assert.equal(restored.state.activeId, null); assert.equal(restored.state.sessions.length, 1);
 await c.close(); await restored.close();
});
test('回合 ID、审批决定、取消事件和变更快照可追踪，重启不重放未完成任务', async () => {
 const c = await demo(); const run = c.command({ type: 'prompt', text: '轨迹测试' });
 await waitFor(() => c.active().permissions.length > 0);
 await assert.rejects(c.command({ type: 'deleteSession', id: c.active().id }));
 await c.command({ type: 'permission', id: c.active().permissions[0].id, optionId: 'allow' }); await run;
 const turn = c.active().turns[0];
 assert.equal(turn.phase, 'completed'); assert.ok(turn.finishedAt! >= turn.startedAt); assert.equal(turn.diffs.length, 1);
 assert.ok(turn.events.some(e => e.kind === 'tool')); assert.ok(turn.events.some(e => e.title.includes('审批决定')));
 assert.ok(c.active().messages.every(m => m.turnId === turn.id));
 const next = c.command({ type: 'prompt', text: '中断记录' }); await waitFor(() => c.active().permissions.length > 0);
 const restored = new Controller(() => {}); restored.restore(c.exportData());
 assert.equal(restored.state.connection, 'disconnected'); assert.equal(restored.active().phase, 'failed'); assert.equal(restored.active().permissions.length, 0);
 assert.equal(restored.active().turns[1].phase, 'failed'); assert.ok(restored.active().turns[1].events.some(e => e.kind === 'error'));
 assert.equal(restored.active().turns[1].finishedAt, undefined);
 await c.command({ type: 'cancel' }); await next;
 assert.ok(c.active().turns[1].events.some(e => e.kind === 'cancel')); assert.equal(c.active().turns[1].phase, 'cancelled');
 const exported = c.sessionExport(c.active().id); assert.equal(exported.format, 'icode-gui-session/v1'); assert.equal(exported.session.turns.length, 2); assert.equal(exported.session.permissions.length, 0);
 await c.close(); await restored.close();
});
test('真实运行时拒绝删除时保留记录，成功后才移除本地会话', async () => {
 const c = new Controller(() => {}); await c.project(process.cwd());
 try {
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  await assert.rejects(c.command({ type: 'deleteSession', id: 'history' })); assert.ok(c.state.sessions.some(s => s.id === 'history'));
  const id = c.active().id; await c.command({ type: 'deleteSession', id }); assert.ok(!c.state.sessions.some(s => s.id === id)); assert.equal(c.state.activeId, null);
 } finally { await c.close(); }
});

test('未落盘空会话删除兼容 iCode 0.31；技能来自当前会话运行时', async () => {
 const c = new Controller(() => {}); await c.project(process.cwd());
 try {
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  await c.command({ type: 'skills' }); assert.deepEqual(c.active().skills, [{ name: 'review-code', description: 'Review changes' }]);
  const s = c.active(); s.id = 'unsaved'; c.state.activeId = 'unsaved';
  await c.command({ type: 'selectSession', id: 'unsaved' });
  await c.command({ type: 'deleteSession', id: 'unsaved' });
  assert.equal(c.state.activeId, null); assert.ok(!c.state.sessions.some(s => s.id === 'unsaved'));
 } finally { await c.close(); }
});

test('Agent 模式来自运行时，过滤子 Agent，切换保留会话、草稿及审批并记录轨迹', async () => {
 const c = new Controller(() => {}); await c.project(process.cwd());
 try {
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  assert.deepEqual(c.state.agents.map(a => a.name), ['Code', 'QA', 'Custom', 'Broken']);
  assert.equal(c.active().agentProfile, 'Code'); const id = c.active().id;
  await c.command({ type: 'draft', id, text: '保留草稿' });
  await c.command({ type: 'skills' }); assert.ok(c.active().skills);
  await c.command({ type: 'agent', name: 'QA' });
  assert.equal(c.active().id, id); assert.equal(c.active().agentProfile, 'QA');
  assert.equal(c.active().draft, '保留草稿'); assert.equal(c.active().approvalMode, 'manual');
  assert.equal(c.active().skills, undefined); assert.equal(c.active().agentChanges?.length, 1);
  await assert.rejects(c.command({ type: 'agent', name: 'Explore' }));
  await assert.rejects(c.command({ type: 'agent', name: 'Broken' }));
  assert.equal(c.active().agentProfile, 'QA'); assert.equal(c.state.transitioning, false);
  await c.command({ type: 'selectSession', id: 'history' }); assert.equal(c.active().agentProfile, 'Code');
  await c.command({ type: 'selectSession', id }); assert.equal(c.active().agentProfile, 'QA');
  const restored = new Controller(() => {}); restored.restore(c.exportData());
  assert.equal(restored.active().agentProfile, 'QA'); assert.equal(restored.active().agentChanges?.length, 1);
  await c.command({ type: 'refreshAgents' }); assert.equal(c.state.agents.length, 4);
  const run = c.command({ type: 'prompt', text: '问答任务' });
  await waitFor(() => c.active().permissions.length > 0);
  await assert.rejects(c.command({ type: 'agent', name: 'Code' }));
  await c.command({ type: 'cancel' }); await run;
  assert.equal(c.active().turns.at(-1)?.agentProfile, 'QA');
 } finally { await c.close(); }
});
test('演示 QA 问答不产生修改审批或模拟 Diff', async () => {
 const c = await demo();
 try {
  await c.command({ type: 'agent', name: 'QA' });
  await c.command({ type: 'prompt', text: '解释项目架构' });
  assert.equal(c.active().phase, 'completed'); assert.equal(c.active().permissions.length, 0);
  assert.equal(c.state.diffs.length, 0); assert.equal(c.active().turns[0].agentProfile, 'QA');
  assert.match(c.active().messages.at(-1)!.text, /QA 问答模式/);
 } finally { await c.close(); }
});

test('发现其他工作空间的 CLI 会话、分页同步、重复同步不重复、点击会话自动连接并回放', async () => {
 const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
 const root = await mkdtemp('/private/tmp/icode-sync-test-'); const source = resolve(root, 'sync-source'); await mkdir(source);
 const c = new Controller(() => {}, () => {}, async () => [source]); await c.project(root);
 try {
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  const workspace = c.state.workspaces.find(w => w.path === source)!;
  assert.equal(workspace.sessionCount, 2); assert.deepEqual(workspace.sessions?.map(s => s.id), ['source-1', 'source-2']);
  await c.command({ type: 'syncSessions' }); assert.equal(workspace.sessionCount, 2);
  assert.match(c.state.syncSummary!, /2 个工作空间、3 个 iCode 会话/);
  await c.command({ type: 'openRemoteSession', path: source, id: 'source-2' });
  assert.equal(c.state.project, source); assert.equal(c.state.connection, 'ready'); assert.equal(c.active().id, 'source-2');
  assert.equal(c.active().messages[0].text, '恢复的消息'); assert.equal(c.active().agentProfile, 'Code');
 } finally { await c.close(); await rm(root, { recursive: true, force: true }); }
});

test('工作空间重命名、归档及移除持久保存，保留会话且同步不自动加回', async () => {
 const c = new Controller(() => {}, () => {}, async () => [process.cwd()]); await c.project(process.cwd());
 try {
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  const id = c.active().id;
  await c.command({ type: 'renameWorkspace', path: process.cwd(), name: '研发工作区' });
  await c.command({ type: 'archiveWorkspace', path: process.cwd(), archived: true });
  assert.equal(c.state.project, ''); assert.equal(c.state.connection, 'disconnected');
  assert.equal(c.state.workspaces[0].archived, true);
  const restored = new Controller(() => {}); restored.restore(c.exportData());
  assert.equal(restored.state.workspaces[0].displayName, '研发工作区');
  await c.command({ type: 'restoreWorkspace', path: process.cwd() });
  await c.project(process.cwd()); assert.ok(c.state.sessions.some(s => s.id === id));
  await c.command({ type: 'removeWorkspace', path: process.cwd() });
  assert.equal(c.state.workspaces[0].removed, true);
  await c.project(resolve('tests'));
  await c.command({ type: 'connect', mode: 'live', executable: resolve('tests/fixtures/fake-icode.mjs') });
  await c.command({ type: 'syncSessions' }); assert.equal(c.state.workspaces[0].removed, true);
  await c.command({ type: 'restoreWorkspace', path: process.cwd() });
  await c.project(process.cwd()); assert.ok(c.state.sessions.some(s => s.id === id));
 } finally { await c.close(); }
});
