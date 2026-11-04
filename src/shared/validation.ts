import type { Command } from './types';
export function validateCommand(value: unknown): Command {
  if (!value || typeof value !== 'object') throw new Error('无效请求');
  const v = value as Record<string, unknown>;
  const text = (key: string, max = 100000) => { if (typeof v[key] !== 'string' || (v[key] as string).length > max) throw new Error(`无效字段：${key}`); };
  switch (v.type) {
    case 'fontSize': if (!Number.isInteger(v.size) || Number(v.size) < 12 || Number(v.size) > 20) throw new Error('界面字号必须为 12–20 的整数'); break;
    case 'connect': if (v.approvalMode !== undefined && !['manual', 'auto', 'bypass'].includes(String(v.approvalMode))) throw new Error('无效审批模式'); text('executable', 4096); if (!['demo', 'live'].includes(String(v.mode)) || !(v.executable as string).trim()) throw new Error('无效连接配置'); break;
    case 'approvalMode': if (!['manual', 'auto', 'bypass'].includes(String(v.mode))) throw new Error('无效审批模式'); break;
    case 'prompt': text('text'); break;
    case 'renameSession': text('id', 4096); text('title', 120); if (!(v.title as string).trim()) throw new Error('会话名称不能为空'); break;
    case 'draft': text('id', 4096); text('text'); break;
    case 'renameWorkspace': text('path', 4096); text('name', 120); if (!(v.name as string).trim()) throw new Error('工作空间名称不能为空'); break;
    case 'archiveWorkspace': text('path', 4096); if (typeof v.archived !== 'boolean') throw new Error('无效归档状态'); break;
    case 'removeWorkspace': case 'restoreWorkspace': case 'workspace': text('path', 4096); break;
    case 'collapseWorkspace': text('path', 4096); if (typeof v.collapsed !== 'boolean') throw new Error('无效折叠状态'); break;
    case 'archiveSession': case 'pinSession': text('id', 4096); if (typeof v[v.type === 'archiveSession' ? 'archived' : 'pinned'] !== 'boolean') throw new Error('无效会话属性'); break;
    case 'selectSession': case 'deleteSession': case 'model': text('id', 4096); break;
    case 'permission': text('id', 4096); text('optionId', 4096); break;
    case 'answer': text('id', 4096); if (!Array.isArray(v.answers) || v.answers.length > 20 || !v.answers.every(a => Array.isArray(a) && a.length <= 100 && a.every(x => typeof x === 'string' && x.length <= 10000))) throw new Error('无效答案'); break;
    case 'openRemoteSession': text('path', 4096); text('id', 4096); break;
    case 'syncSessions': break;
    case 'agent': text('name', 256); if (!(v.name as string).trim()) throw new Error('无效 Agent'); break;
    case 'refreshAgents': case 'skills': case 'clearError': case 'newSession': case 'cancel': break;
    default: throw new Error('未知请求类型');
  }
  return v as Command;
}
