#!/usr/bin/env node
// Deliberately uses raw JSON-RPC to exercise SDK framing against another implementation.
import { createInterface } from 'node:readline';
let session = 'fake-session', pendingPrompt, permissionId = 900, questionId = 901;
let approvalMode = process.argv[process.argv.indexOf('--approval') + 1] ?? 'manual';
const agents = new Map();
const modes = () => ({ currentModeId: approvalMode, availableModes: ['manual','auto','bypass'].map(id => ({ id, name: id })) });
const send = obj => { const line = JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n'; const split = Math.floor(line.length / 2); process.stdout.write(line.slice(0, split)); process.stdout.write(line.slice(split)); };
createInterface({ input: process.stdin }).on('line', line => {
 const m = JSON.parse(line);
 if (m.id === permissionId && !m.method) {
   send({ method: '_chrys/request_input', id: questionId, params: { sessionId: session, requestId: 'question-1', callerName: 'Code', questions: [{ question: '命名？', options: [], multiSelect: false }] } }); return;
 }
 if (m.id === questionId && !m.method) { send({ id: pendingPrompt, result: { stopReason: 'end_turn' } }); return; }
 const reply = result => send({ id: m.id, result });
 switch (m.method) {
  case 'initialize': reply({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } }, agentInfo: { name: 'fake-icode', version: 'fixture-1' } }); break;
  case 'session/new': reply({ sessionId: session, modes: modes(), models: { currentModelId: 'mock', availableModels: [{ modelId: 'mock', name: 'Test' }] } }); break;
  case 'session/list': if (m.params.cwd.endsWith('sync-source')) { reply({ sessions: [{ sessionId: m.params.cursor ? 'source-2' : 'source-1', title: m.params.cursor ? '第二页会话' : 'CLI 会话', updatedAt: '2026-10-23T10:00:00Z' }], ...(m.params.cursor ? {} : { nextCursor: 'next' }) }); break; } reply({ sessions: [{ sessionId: 'history', cwd: process.cwd(), title: '已保存会话' }] }); break;
  case 'session/load': session = m.params.sessionId; approvalMode = 'manual'; send({ method: 'session/update', params: { sessionId: session, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '恢复的消息' } } } }); reply({ modes: modes() }); break;
  case 'session/set_mode': approvalMode = m.params.modeId; send({ method: 'session/update', params: { sessionId: session, update: { sessionUpdate: 'current_mode_update', currentModeId: approvalMode } } }); reply({}); break;
  case 'session/prompt':
   session = m.params.sessionId;
   pendingPrompt = m.id;
   process.stderr.write('fixture diagnostic\n');
   send({ method: 'session/update', params: { sessionId: session, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好，' } } } });
   send({ method: 'session/update', params: { sessionId: session, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP' } } } });
   send({ method: 'session/request_permission', id: permissionId, params: { sessionId: session, toolCall: { toolCallId: 'tool-1', title: 'Write file', rawInput: { path: 'hello.ts' } }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] } }); break;
  case 'session/cancel': send({ id: pendingPrompt, result: { stopReason: 'cancelled' } }); break;
  case '_profiles/agents/list': reply({ agents: [
   { name: 'Code', displayName: 'Code Agent', description: 'Coding' },
   { name: 'QA', displayName: 'Q&A Agent', description: 'Questions' },
   { name: 'Custom', displayName: 'My Agent', description: 'Custom agent' },
   { name: 'Broken', displayName: 'Broken', description: 'Fails to load' },
   { name: 'Explore', subAgentOnly: true }, { name: 'General', subAgentOnly: true }
  ] }); break;
  case '_session/switch_agent':
   if (m.params.agentProfile === 'Broken') { send({ id: m.id, error: { code: -32603, message: 'Agent load failed' } }); break; }
   agents.set(m.params.sessionId, m.params.agentProfile); reply({ toProfile: m.params.agentProfile, modelProfileId: 'mock' }); break;
  case '_skills/list': reply({ skillDetails: [{ name: 'review-code', description: 'Review changes' }] }); break;
  case '_session/delete': if (m.params.sessionId === 'unsaved') { send({ id: m.id, error: { code: -32602, message: 'Invalid params', data: { details: 'Session not found: unsaved' } } }); break; } if (m.params.sessionId === 'history') send({ id: m.id, error: { code: -32603, message: 'protected session' } }); else reply({}); break;
  case '_session/diff': reply({ entries: [{ path: 'hello.ts', beforeText: '', afterText: 'hello\n', isBinary: false }] }); break;
  case '_chrys/session_runtime': reply({ agentProfile: agents.get(m.params.sessionId) ?? 'Code', modelProfileId: 'mock' }); break;
  case 'session/close': reply({}); break;
  default: if (m.id != null) send({ id: m.id, error: { code: -32601, message: 'not found' } });
 }
});
