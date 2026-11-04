import React, { useState } from 'react';
import { MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, X } from 'lucide-react';
import type { Command, State, WorkspaceInfo } from '../shared/types';
export const workspaceName = (w: WorkspaceInfo) => w.displayName || w.path.split(/[\\/]/).filter(Boolean).at(-1) || w.path;
export function WorkspaceControls({ workspace: w, state, send, busy }: { workspace: WorkspaceInfo; state: State; send: (command: Command) => Promise<boolean>; busy: boolean }) {
 const [menu, setMenu] = useState(false); const [action, setAction] = useState<'rename' | 'remove' | null>(null);
 const [name, setName] = useState(''); const [pending, setPending] = useState(false);
 async function perform() {
  if (!action || pending) return; setPending(true);
  try { if (await send(action === 'rename' ? { type: 'renameWorkspace', path: w.path, name } : { type: 'removeWorkspace', path: w.path })) setAction(null); }
  finally { setPending(false); }
 }
 return <div className="workspace-actions"><button aria-label={`工作空间操作 ${workspaceName(w)}`} disabled={busy} onClick={() => setMenu(!menu)}><MoreHorizontal size={14}/></button>
 {menu && <><button className="menu-dismiss" aria-label="关闭工作空间菜单" onClick={() => setMenu(false)}/><div className="session-menu workspace-menu">
 <button onClick={() => { setName(workspaceName(w)); setAction('rename'); setMenu(false); }}><Pencil size={14}/>重命名工作空间</button>
 {w.removed || w.archived ? <button onClick={() => { void send({ type: 'restoreWorkspace', path: w.path }); setMenu(false); }}><ArchiveRestore size={14}/>恢复工作空间</button> : <button onClick={() => { void send({ type: 'archiveWorkspace', path: w.path, archived: true }); setMenu(false); }}><Archive size={14}/>归档工作空间</button>}
 {!w.removed && <button className="danger" onClick={() => { setAction('remove'); setMenu(false); }}><Trash2 size={14}/>移除工作空间</button>}
 </div></>}
 {action && <div className="modal-overlay" onClick={() => !pending && setAction(null)} onKeyDown={e => { if (e.key === 'Escape' && !pending) setAction(null); }}><section className="modal compact" role="dialog" aria-modal="true" aria-label={action === 'rename' ? '重命名工作空间' : '移除工作空间'} onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{action === 'rename' ? '重命名工作空间' : '移除工作空间'}</h2><button aria-label="关闭工作空间操作" disabled={pending} onClick={() => setAction(null)}><X size={18}/></button></div><p className="workspace-path">{w.path}</p>
 {action === 'rename' ? <><label htmlFor="workspace-display-name">工作空间显示名称</label><input autoFocus id="workspace-display-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) void perform(); }}/><p className="field-help">只修改侧栏名称，不修改磁盘目录或 iCode 会话归属。</p></> : <p className="field-help">将此目录从常用列表移除。磁盘文件、iCode 会话及本地缓存均保留，可在“已移除”中恢复；同步不会自动加回。</p>}
 {state.error && <p role="alert" className="error-banner">{state.error}</p>}<div className="dialog-actions"><button disabled={pending} onClick={() => setAction(null)}>取消</button><button className={action === 'remove' ? 'danger-button' : 'primary'} disabled={pending || (action === 'rename' && !name.trim())} onClick={perform}>{pending ? '处理中…' : action === 'rename' ? '保存名称' : '确认移除'}</button></div></section></div>}
 </div>;
}
