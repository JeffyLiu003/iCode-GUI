import { randomUUID } from 'node:crypto';
import { AcpRuntime, type Json } from './acp';
import type { State, Session, Command, Diff, ApprovalMode, SavedData, WorkspaceData, Turn, TraceEvent } from '../shared/types';
export const initialState = (): State => ({ fontSize: 13, mode: 'demo', connection: 'disconnected', project: '', executable: 'icode', sessions: [], activeId: null, diffs: [], error: '', logs: [], runtimeVersion: '', models: [], modelId: '', approvalMode: 'manual', storageError: '', transitioning: false, workspaces: [], agents: [], agentError: '' });
const busy = (s: Session) => s.phase === 'running' || s.phase === 'cancelling';
export class Controller {
  state = initialState();
  private runtime?: AcpRuntime;
  private pending = new Map<string, { sessionId: string; resolve: (value: Json) => void }>();
  private demoAbort?: AbortController;
  private _changing = false;
  private get changing() { return this._changing; }
  private set changing(value: boolean) { this._changing = value; this.state.transitioning = value; this.emit(); }
  private buckets = new Map<string, WorkspaceData>();
  private loaded = new Set<string>();
  constructor(private publish: (state: State) => void, private persist: (state: State) => void = () => {}, private discoverWorkspaces: () => Promise<string[]> = async () => []) {}
  emit() { this.remember(); this.publish(structuredClone(this.state)); this.persist(this.state); }
  active() { const s = this.state.sessions.find(s => s.id === this.state.activeId); if (!s) throw new Error('请先新建或选择会话'); return s; }
  private fail(error: unknown) { this.state.error = error instanceof Error ? error.message : String(error); const details = (error as { data?: { details?: unknown } })?.data?.details; if (typeof details === 'string') this.state.error += `：${details}`; if (this.state.error.includes('ENOENT')) this.state.error = '找不到 iCode 程序或项目目录，请检查设置中的路径。'; this.emit(); }
  private key(project = this.state.project, mode = this.state.mode) { return JSON.stringify([project, mode]); }
  private remember() {
    if (this.state.project) this.buckets.set(this.key(), { project: this.state.project, mode: this.state.mode, sessions: this.state.sessions, activeId: this.state.activeId });
    const workspace = this.state.workspaces.find(w => w.path === this.state.project);
    if (workspace) workspace.sessionCount = this.state.sessions.filter(s => !s.archived).length;
    for (const w of this.state.workspaces) {
      const sessions = this.buckets.get(this.key(w.path))?.sessions ?? [];
      w.sessions = sessions.filter(s => !s.archived).map(s => ({ id: s.id, title: s.customTitle || s.title }));
      w.sessionCount = w.sessions.length;
    }
  }
  exportData(): SavedData {
    this.remember();
    const buckets = structuredClone([...this.buckets.values()]);
    for (const bucket of buckets) for (const s of bucket.sessions) { s.permissions = []; s.questions = []; }
    return { fontSize: this.state.fontSize, version: 1, project: this.state.project, mode: this.state.mode, executable: this.state.executable, workspaces: structuredClone(this.state.workspaces), buckets };
  }
  restore(data: SavedData) {
    this.state.fontSize = Number.isInteger(data.fontSize) && data.fontSize! >= 12 && data.fontSize! <= 20 ? data.fontSize! : 13;
    if (data.version !== 1) throw new Error('不支持的历史版本');
    const buckets = new Map<string, WorkspaceData>();
    for (const bucket of data.buckets) {
      if (typeof bucket.project !== 'string' || !['live', 'demo'].includes(bucket.mode) || !Array.isArray(bucket.sessions)) throw new Error('本地工作区数据损坏');
      for (const s of bucket.sessions) {
        if (typeof s.id !== 'string' || typeof s.title !== 'string' || !Array.isArray(s.messages) || !Array.isArray(s.turns)) throw new Error('本地会话数据损坏');
        s.permissions = []; s.questions = [];
        if (busy(s)) s.phase = 'failed';
        for (const turn of s.turns) if (turn.phase === 'running' || turn.phase === 'cancelling') { turn.phase = 'failed'; turn.events.push({ id: randomUUID(), time: Date.now(), kind: 'error', title: '应用在执行期间退出，运行状态未知；未自动重发任务' }); }
      }
      buckets.set(this.key(bucket.project, bucket.mode), bucket);
    }
    this.buckets = buckets; this.state.project = data.project; this.state.mode = data.mode; this.state.executable = data.executable;
    this.state.workspaces = data.workspaces; this.recall();
  }
  private recall() {
    const data = this.buckets.get(this.key()); this.state.sessions = data?.sessions ?? [];
    this.state.activeId = data?.activeId ?? null;
    const active = this.state.sessions.find(s => s.id === this.state.activeId);
    this.state.diffs = active?.diffs ?? []; this.state.approvalMode = active?.approvalMode ?? this.state.approvalMode;
  }
  private find(id: string) { const s = this.state.sessions.find(s => s.id === id); if (!s) throw new Error('会话不存在'); return s; }
  private trace(s: Session, kind: TraceEvent['kind'], title: string, detail?: string, referenceId?: string) {
    const turn = s.turns.at(-1); if (!turn || !busy(s)) return;
    turn.events.push({ id: randomUUID(), time: Date.now(), kind, title, detail, referenceId });
  }
  async project(path: string) {
    if (this.changing || this.state.sessions.some(busy)) throw new Error('请先停止当前任务');
    this.remember(); await this.close(); this.state.project = path; this.loaded.clear();
    if (!this.state.workspaces.some(w => w.path === path)) this.state.workspaces.push({ path, collapsed: false, sessionCount: 0 });
    const w = this.state.workspaces.find(w => w.path === path); if (w) { w.archived = false; w.removed = false; }
    this.recall(); this.state.connection = 'disconnected'; this.state.models = []; this.state.modelId = ''; this.state.agents = []; this.state.agentError = ''; this.emit();
  }
  sessionExport(id: string) {
    const s = this.find(id);
    return { format: 'icode-gui-session/v1', exportedAt: new Date().toISOString(), workspace: this.state.project, mode: this.state.mode, runtimeVersion: this.state.runtimeVersion, session: { ...structuredClone(s), permissions: [], questions: [] } };
  }
  private async remove(id: string) {
    if (this.changing || this.state.sessions.some(busy)) throw new Error('请先停止任务再删除会话');
    const s = this.find(id); this.changing = true;
    try {
      if (this.state.mode === 'live') {
        if (!this.runtime || this.state.connection !== 'ready') throw new Error('删除真实会话需要连接 iCode；可先归档隐藏');
        const params = { sessionId: s.id, cwd: this.state.project };
        const missing = (error: unknown) => {
          const e = error as { code?: number; data?: { details?: string } };
          return e?.code === -32602 && e.data?.details === `Session not found: ${s.id}`;
        };
        try { await this.runtime.extension('session/delete', params); }
        catch (error) {
          if (!missing(error)) throw error;
          // iCode 0.31 resolves deletion through saved metadata: a new empty
          // session has none. Close its active host, then retry in case closing
          // flushed metadata. Only the exact missing-target response is idempotent.
          if (this.loaded.has(id)) { await this.runtime.request('session/close', { sessionId: id }); this.loaded.delete(id); }
          try { await this.runtime.extension('session/delete', params); }
          catch (retryError) { if (!missing(retryError)) throw retryError; }
        }
      }
      this.loaded.delete(id); this.state.sessions = this.state.sessions.filter(s => s.id !== id);
      if (this.state.activeId === id) { this.state.activeId = null; this.state.diffs = []; }
    } finally { this.changing = false; }
  }
  async command(command: Command) {
    this.state.error = '';
    try {
      switch (command.type) {
        case 'fontSize':
          if (!Number.isInteger(command.size) || command.size < 12 || command.size > 20) throw new Error('界面字号必须为 12–20 的整数');
          this.state.fontSize = command.size; break;
        case 'clearError': break;
        case 'renameWorkspace': {
          const w = this.state.workspaces.find(w => w.path === command.path); if (!w) throw new Error('工作空间不存在');
          w.displayName = command.name.trim(); break;
        }
        case 'archiveWorkspace': case 'removeWorkspace': case 'restoreWorkspace': {
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请先结束当前任务再管理工作空间');
          const w = this.state.workspaces.find(w => w.path === command.path); if (!w) throw new Error('工作空间不存在');
          this.changing = true;
          try {
            const hide = command.type === 'removeWorkspace' || (command.type === 'archiveWorkspace' && command.archived);
            if (hide && w.path === this.state.project) {
              this.remember(); await this.close(); this.loaded.clear(); this.state.project = ''; this.recall();
              this.state.connection = 'disconnected'; this.state.models = []; this.state.modelId = ''; this.state.agents = []; this.state.agentError = '';
            }
            if (command.type === 'removeWorkspace') { w.removed = true; w.archived = false; }
            else if (command.type === 'restoreWorkspace') { w.removed = false; w.archived = false; }
            else w.archived = command.archived;
          } finally { this.changing = false; }
          break;
        }
        case 'syncSessions': {
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请等待任务结束后同步会话');
          this.changing = true;
          try {
            if (!this.runtime || this.state.connection !== 'ready' || this.state.mode !== 'live') await this.connect('live', this.state.executable, this.state.approvalMode);
            else { await this.refreshAgents(); await this.syncSessions(); }
          } finally { this.changing = false; } break;
        }
        case 'openRemoteSession': {
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请先结束当前任务');
          const bucket = this.buckets.get(this.key(command.path, 'live'));
          if (!bucket?.sessions.some(s => s.id === command.id)) throw new Error('请先同步该会话');
          await this.project(command.path);
          this.changing = true;
          try {
            this.state.mode = 'live'; this.recall(); this.state.activeId = command.id;
            await this.connect('live', this.state.executable, this.state.approvalMode);
          } finally { this.changing = false; } break;
        }
        case 'refreshAgents': {
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请等待当前操作完成');
          this.changing = true; try { await this.refreshAgents(); } finally { this.changing = false; } break;
        }
        case 'agent': {
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请等待任务结束后切换 Agent');
          if (this.state.connection !== 'ready') throw new Error('请先连接运行时');
          const s = this.active(); if (s.archived) throw new Error('请先恢复已归档会话');
          if (!this.state.agents.some(a => a.name === command.name)) throw new Error('该 Agent 不可用于主会话，请刷新列表');
          const from = s.agentProfile ?? '未知'; if (from === command.name) break;
          this.changing = true;
          try {
            const result = this.runtime ? await this.runtime.extension('session/switch_agent', { sessionId: s.id, agentProfile: command.name }, 75000) : { toProfile: command.name };
            s.agentProfile = result.toProfile ?? command.name; s.skills = undefined;
            if (typeof result.modelProfileId === 'string') this.state.modelId = result.modelProfileId;
            s.agentChanges ??= []; s.agentChanges.push({ time: Date.now(), from, to: s.agentProfile! });
            s.updatedAt = Date.now();
          } finally { this.changing = false; }
          break;
        }
        case 'skills': {
          if (this.changing || !this.runtime || this.state.connection !== 'ready') throw new Error('请先连接真实 iCode 并选择会话');
          const s = this.active();
          const result = await this.runtime.extension('skills/list', { sessionId: s.id });
          s.skills = (result.skillDetails ?? []).filter((v: Json) => typeof v.name === 'string').map((v: Json) => ({ name: v.name, description: typeof v.description === 'string' ? v.description : '' }));
          break;
        }
        case 'workspace': if (!this.state.workspaces.some(w => w.path === command.path)) throw new Error('未知工作空间'); await this.project(command.path); break;
        case 'collapseWorkspace': { const w = this.state.workspaces.find(w => w.path === command.path); if (!w) throw new Error('未知工作空间'); w.collapsed = command.collapsed; break; }
        case 'renameSession': this.find(command.id).customTitle = command.title.trim(); break;
        case 'archiveSession': { const s = this.find(command.id); if (busy(s)) throw new Error('请先停止任务再归档'); s.archived = command.archived; break; }
        case 'pinSession': this.find(command.id).pinned = command.pinned; break;
        case 'deleteSession': await this.remove(command.id); break;
        case 'draft': this.find(command.id).draft = command.text; break;
        case 'connect':
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请等待当前操作完成');
          this.changing = true;
          try { await this.connect(command.mode, command.executable, command.approvalMode ?? this.state.approvalMode); } finally { this.changing = false; } break;
        case 'newSession':
          if (this.changing) throw new Error('正在切换会话，请稍候');
          this.changing = true;
          try { await this.newSession(); } finally { this.changing = false; } break;
        case 'selectSession':
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请先完成或停止任务');
          this.changing = true;
          try { await this.select(command.id); } finally { this.changing = false; } break;
        case 'prompt': if (this.changing) throw new Error('连接准备中'); await this.prompt(command.text); break;
        case 'cancel': await this.cancel(); break;
        case 'permission': this.permission(command.id, command.optionId); break;
        case 'answer': this.answer(command.id, command.answers); break;
        case 'approvalMode': {
          if (this.changing || this.state.sessions.some(busy)) throw new Error('请等待任务结束后切换审批模式');
          if (this.state.connection !== 'ready') throw new Error('请先连接运行时');
          const session = this.active();
          if (!session.approvalModes.includes(command.mode)) throw new Error('当前运行时不支持此审批模式');
          this.changing = true;
          try { await this.runtime?.request('session/set_mode', { sessionId: session.id, modeId: command.mode }); session.approvalMode = command.mode; this.trace(session, 'mode', `审批模式切换为 ${command.mode}`); this.state.approvalMode = command.mode; }
          finally { this.changing = false; }
          break;
        }
        case 'model':
          if (this.state.sessions.some(busy)) throw new Error('运行中不能切换模型');
          if (!this.state.models.some(m => m.id === command.id)) throw new Error('未知模型');
          await this.runtime?.request('session/set_model', { sessionId: this.active().id, modelId: command.id }); this.state.modelId = command.id; break;
      }
      this.emit();
    } catch (error) { this.fail(error); throw error; }
  }
  private async connect(mode: 'demo' | 'live', executable: string, approvalMode: ApprovalMode) {
    if (!this.state.project) throw new Error('请先选择项目文件夹');
    this.remember(); await this.close();
    this.state.approvalMode = approvalMode; this.state.mode = mode; this.state.executable = executable; this.state.connection = 'connecting'; this.state.diffs = []; this.loaded.clear(); this.state.activeId = null; this.state.models = []; this.state.modelId = ''; this.recall(); this.emit();
    if (mode === 'demo') { this.state.runtimeVersion = '交互演示 · 不执行工具'; this.state.connection = 'ready'; await this.refreshAgents(); if (!this.state.sessions.length) await this.newSession(); return; }
    const runtime = new AcpRuntime(); this.runtime = runtime;
    try {
      this.state.runtimeVersion = await runtime.start(executable, this.state.project, {
        update: params => this.update(params),
        permission: (params, signal) => this.waitPermission(params, signal), question: (params, signal) => this.waitQuestion(params, signal),
        log: line => { this.state.logs = [...this.state.logs, line.replace(/(api[_-]?key|authorization|bearer)\s*[:= ]+\S+/gi, '$1 [REDACTED]')].slice(-80); this.emit(); },
        disconnected: reason => { this.releasePending(); for (const s of this.state.sessions) if (busy(s)) { this.trace(s, 'error', reason); s.phase = 'failed'; const turn = s.turns.at(-1); if (turn) { turn.phase = 'failed'; turn.finishedAt = Date.now(); } } this.state.connection = 'error'; this.state.error = reason; this.emit(); },
      }, approvalMode);
      this.state.connection = 'ready';
      await this.refreshAgents();
      await this.syncSessions();
      const active = this.state.sessions.find(s => s.id === this.state.activeId && !s.archived);
      if (active) await this.select(active.id); else await this.newSession();
    } catch (e) { await runtime.stop(); this.runtime = undefined; this.state.connection = 'error'; throw e; }
  }
  private async syncSessions() {
    if (!this.runtime) throw new Error('请先连接真实 iCode');
    const paths = new Set([this.state.project, ...this.state.workspaces.map(w => w.path), ...await this.discoverWorkspaces()]);
    let total = 0; let count = 0; const failures: string[] = [];
    for (const path of paths) {
      if (this.state.workspaces.some(w => w.path === path && (w.archived || w.removed))) continue;
      let cursor: string | undefined; const seen = new Set<string>(); const remoteSessions: Json[] = [];
      try {
        do {
          const result = await this.runtime.request('session/list', { cwd: path, ...(cursor ? { cursor } : {}) });
          remoteSessions.push(...(result.sessions ?? [])); cursor = result.nextCursor ?? undefined;
          if (cursor && seen.has(cursor)) throw new Error('运行时会话分页游标重复');
          if (cursor) seen.add(cursor);
        } while (cursor);
        const key = this.key(path, 'live');
        const bucket = path === this.state.project ? { project: path, mode: 'live' as const, sessions: this.state.sessions, activeId: this.state.activeId } : this.buckets.get(key) ?? { project: path, mode: 'live' as const, sessions: [], activeId: null };
        for (const remote of remoteSessions) {
          if (typeof remote.sessionId !== 'string') continue;
          let s = bucket.sessions.find(s => s.id === remote.sessionId);
          if (!s) { s = this.session(remote.sessionId, remote.title || 'iCode 历史会话'); bucket.sessions.push(s); }
          else if (remote.title) s.title = remote.title;
          const time = Date.parse(remote.updatedAt); if (Number.isFinite(time)) s.updatedAt = Math.max(s.turns.length ? s.updatedAt : 0, time);
        }
        this.buckets.set(key, bucket);
        if (remoteSessions.length || path === this.state.project) {
          if (!this.state.workspaces.some(w => w.path === path)) this.state.workspaces.push({ path, collapsed: false, sessionCount: 0 });
          count++; total += remoteSessions.length;
        }
      } catch (error) {
        if (path === this.state.project) throw error;
        failures.push(`${path}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.state.syncedAt = Date.now();
    this.state.syncSummary = `已同步 ${count} 个工作空间、${total} 个 iCode 会话${failures.length ? `；${failures.length} 个目录读取失败（见日志）` : ''}`;
    this.state.logs.push(...failures);
  }
  private async refreshAgents() {
    this.state.agentError = '';
    if (this.state.connection !== 'ready') throw new Error('请先连接运行时');
    if (!this.runtime) { this.state.agents = [{ name: 'Code', displayName: 'Code · 编码', description: '演示编码模式，不执行真实工具' }, { name: 'QA', displayName: 'QA · 问答', description: '演示问答模式，不执行真实工具' }]; return; }
    try {
      const result = await this.runtime.extension('profiles/agents/list', {});
      this.state.agents = (result.agents ?? []).filter((a: Json) => typeof a.name === 'string' && !a.subAgentOnly).map((a: Json) => ({ name: a.name, displayName: typeof a.displayName === 'string' ? a.displayName : a.name, description: typeof a.description === 'string' ? a.description : '' }));
    } catch (error) { this.state.agents = []; this.state.agentError = `Agent 列表不可用：${error instanceof Error ? error.message : String(error)}`; }
  }
  private async syncAgent(s: Session) {
    if (!this.runtime) { s.agentProfile ??= 'Code'; return; }
    try {
      const rt = await this.runtime.extension('chrys/session_runtime', { sessionId: s.id });
      s.agentProfile = typeof rt.agentProfile === 'string' ? rt.agentProfile : undefined;
      this.state.modelId = rt.modelProfileId ?? this.state.modelId;
    } catch (error) {
      s.agentProfile = undefined;
      if ((error as { code?: number })?.code !== -32601) throw error;
      this.state.agentError = '当前运行时不支持读取会话 Agent，无法确认当前模式';
    }
  }
  private session(id: string, title = '新会话'): Session { return { id, title, archived: false, pinned: false, draft: '', turns: [], diffs: [], messages: [], phase: 'idle', permissions: [], questions: [], updatedAt: Date.now(), approvalMode: this.state.approvalMode, approvalModes: this.state.mode === 'demo' ? ['manual', 'auto', 'bypass'] : ['manual'] }; }
  private async newSession() {
    if (this.state.connection !== 'ready') throw new Error('请先连接运行时');
    if (this.state.sessions.some(busy)) throw new Error('请先停止当前任务');
    const result = this.runtime ? await this.runtime.request('session/new', { cwd: this.state.project, mcpServers: [] }) : { sessionId: randomUUID() };
    const s = this.session(result.sessionId); this.state.sessions.unshift(s); this.state.activeId = s.id; this.loaded.add(s.id); this.state.diffs = []; this.models(result); this.sessionModes(s, result); await this.syncAgent(s);
    if (this.runtime && s.approvalMode !== this.state.approvalMode && s.approvalModes.includes(this.state.approvalMode)) { await this.runtime.request('session/set_mode', { sessionId: s.id, modeId: this.state.approvalMode }); s.approvalMode = this.state.approvalMode; }
  }
  private sessionModes(s: Session, result: Json) {
    const modes = result.modes;
    if (modes) { s.approvalModes = (modes.availableModes ?? []).map((m: Json) => m.id).filter((id: string) => ['manual', 'auto', 'bypass'].includes(id)); if (s.approvalModes.includes(modes.currentModeId)) s.approvalMode = modes.currentModeId; }
  }
  private models(result: Json) { this.state.models = (result.models?.availableModels ?? []).map((m: Json) => ({ id: m.modelId, name: m.name })); this.state.modelId = result.models?.currentModelId ?? ''; }
  private async select(id: string) {
    const s = this.state.sessions.find(s => s.id === id); if (!s) throw new Error('未知会话');
    this.state.activeId = id; this.state.diffs = s.diffs;
    if (this.state.connection !== 'ready') { this.state.approvalMode = s.approvalMode; return; }
    if (this.runtime) { if (!this.loaded.has(id)) { const cached = s.messages; s.messages = []; try { const result = await this.runtime.request('session/load', { sessionId: id, cwd: this.state.project, mcpServers: [] }); this.models(result); this.sessionModes(s, result); this.loaded.add(id); } catch (error) { s.messages = cached; throw error; } } await this.syncAgent(s); await this.refreshDiff(id); }
    this.state.approvalMode = s.approvalMode;
  }
  private async prompt(text: string) {
    if (this.state.connection !== 'ready') throw new Error('请先连接运行时');
    if (!text.trim() || text.length > 100000) throw new Error('请输入有效需求（最多 100000 字符）');
    if (this.state.sessions.some(busy)) throw new Error('同一工作区已有任务运行');
    const s = this.active(); if (s.archived) throw new Error('请先恢复已归档会话');
    if (this.runtime && !this.loaded.has(s.id)) await this.select(s.id);
    const turn: Turn = { agentProfile: s.agentProfile, id: randomUUID(), prompt: text.trim(), startedAt: Date.now(), phase: 'running', model: this.state.modelId || (this.runtime ? '运行时默认模型' : '演示'), approvalMode: s.approvalMode, events: [], diffs: [] };
    s.turns.push(turn); s.draft = '';
    s.messages.push({ id: randomUUID(), role: 'user', text: text.trim(), turnId: turn.id, time: Date.now() });
    if (s.title === '新会话') s.title = text.trim().slice(0, 26);
    s.phase = 'running'; this.trace(s, 'run', '开始执行', text.trim()); s.updatedAt = Date.now(); this.state.diffs = []; this.emit();
    try {
      if (this.runtime) {
        // A prompt is intentionally not given a short RPC timeout: human callbacks may take minutes.
        const result = await this.runtime.agent.request('session/prompt', { sessionId: s.id, prompt: [{ type: 'text', text }] });
        this.trace(s, 'run', `运行时结束原因：${result.stopReason}`);
        const phase = result.stopReason === 'cancelled' ? 'cancelled' : 'completed';
        await this.refreshDiff(s.id);
        if (busy(s)) s.phase = phase;
      } else await this.demo(s);
    } catch (error) { this.trace(s, 'error', '任务失败', String(error)); s.phase = 'failed'; this.fail(error); }
    finally { turn.phase = s.phase; turn.finishedAt = Date.now(); turn.diffs = structuredClone(this.state.diffs); s.diffs = structuredClone(this.state.diffs); s.updatedAt = Date.now(); turn.events.push({ id: randomUUID(), time: Date.now(), kind: 'run', title: s.phase === 'completed' ? '任务完成' : s.phase === 'cancelled' ? '任务已停止' : '任务失败' }); this.releasePending(s.id); this.emit(); }
  }
  private async refreshDiff(id: string) {
    try {
      const result = await this.runtime?.extension('session/diff', { sessionId: id });
      // Accept only the upstream text snapshot fields. No guessed Git diffs.
      const entries = result?.entries ?? [];
      const diffs: Diff[] = entries.filter((d: Json) => typeof d.path === 'string' && !d.isBinary && typeof d.beforeText === 'string' && typeof d.afterText === 'string').map((d: Json) => ({ path: d.path, before: d.beforeText, after: d.afterText }));
      this.find(id).diffs = diffs; if (this.state.activeId === id) this.state.diffs = diffs;
    } catch { this.state.logs.push('当前运行时未提供可读取的文本 Diff；请在工作区核对变更。'); }
  }
  update(params: Json) {
    const s = this.state.sessions.find(s => s.id === params.sessionId); if (!s) return;
    const u = params.update; if (!u) return;
    if (u.sessionUpdate === 'current_mode_update' && s.approvalModes.includes(u.currentModeId)) { s.approvalMode = u.currentModeId; if (s.id === this.state.activeId) this.state.approvalMode = s.approvalMode; }
    if (u.sessionUpdate === 'session_info_update' && u.title) s.title = u.title;
    if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'user_message_chunk') {
      const role = u.sessionUpdate === 'agent_message_chunk' ? 'assistant' : 'user';
      if (u.content?.type === 'text') { const last = s.messages.at(-1); if (last?.role === role && last.turnId === (busy(s) ? s.turns.at(-1)?.id : undefined)) last.text += u.content.text; else s.messages.push({ id: randomUUID(), role, text: u.content.text, turnId: busy(s) ? s.turns.at(-1)?.id : undefined, time: busy(s) ? Date.now() : undefined }); }
    }
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const id = `tool-${busy(s) ? s.turns.at(-1)?.id : 'history'}-${u.toolCallId}`; const existing = s.messages.find(m => m.id === id);
      const content = (u.content ?? []).map((c: Json) => c.content?.text ?? '').join('\n').slice(0, 12000);
      if (existing) { existing.status = u.status ?? existing.status; if (content) existing.text = `${u.title ?? existing.text.split('\n')[0]}\n${content}`; }
      else s.messages.push({ id, role: 'tool', text: `${u.title ?? '工具执行'}${content ? '\n' + content : ''}`, status: u.status, turnId: busy(s) ? s.turns.at(-1)?.id : undefined, time: busy(s) ? Date.now() : undefined });
      this.trace(s, 'tool', `${u.title ?? '工具执行'} · ${u.status ?? '更新'}`, content || (u.rawInput ? JSON.stringify(u.rawInput, null, 2) : undefined), id);
    }
    this.emit();
  }
  private waitPermission(params: Json, signal?: AbortSignal): Promise<Json> {
    const s = this.state.sessions.find(s => s.id === params.sessionId); if (!s) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    const id = randomUUID();
    this.trace(s, 'approval', '等待工具授权', `${params.toolCall?.title ?? '工具请求'}\n${JSON.stringify(params.toolCall?.rawInput ?? {}, null, 2)}`, id);
    s.permissions.push({ id, title: params.toolCall?.title ?? '工具请求授权', details: JSON.stringify(params.toolCall?.rawInput ?? {}, null, 2), options: params.options });
    return this.waitCallback(s, id, signal);
  }
  private waitQuestion(params: Json, signal?: AbortSignal): Promise<Json> {
    const s = this.state.sessions.find(s => s.id === params.sessionId);
    if (!s || !Array.isArray(params.questions) || params.questions.length > 20 || !params.questions.every((q: Json) => typeof q.question === 'string' && Array.isArray(q.options) && q.options.every((o: Json) => typeof o.label === 'string'))) return Promise.resolve({ cancelled: true, answers: [] });
    const id = randomUUID(); this.trace(s, 'question', '等待用户回答', params.questions.map((q: Json) => q.question).join('；'), id); s.questions.push({ id, questions: params.questions });
    return this.waitCallback(s, id, signal);
  }
  private waitCallback(s: Session, id: string, signal?: AbortSignal): Promise<Json> {
    return new Promise(resolve => {
      const cancel = () => { const question = s.questions.some(q => q.id === id); s.permissions = s.permissions.filter(p => p.id !== id); s.questions = s.questions.filter(q => q.id !== id); this.pending.delete(id); resolve(question ? { cancelled: true, answers: [] } : { outcome: { outcome: 'cancelled' } }); this.emit(); };
      const finish = (value: Json) => { signal?.removeEventListener('abort', cancel); resolve(value); };
      this.pending.set(id, { sessionId: s.id, resolve: finish });
      if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
      this.emit();
    });
  }
  private permission(id: string, optionId: string) {
    const s = this.active(); const p = s.permissions.find(p => p.id === id); if (!p?.options.some(o => o.optionId === optionId)) throw new Error('授权请求已失效或选项无效');
    this.trace(s, 'approval', `审批决定：${p.options.find(o => o.optionId === optionId)?.name}`, p.title, id);
    this.pending.get(id)?.resolve({ outcome: { outcome: 'selected', optionId } }); this.pending.delete(id); s.permissions = s.permissions.filter(p => p.id !== id);
  }
  private answer(id: string, answers: string[][]) {
    const s = this.active(); const q = s.questions.find(q => q.id === id); if (!q || answers.length !== q.questions.length) throw new Error('问题已失效或答案数量错误');
    for (let i = 0; i < answers.length; i++) { if ((!q.questions[i].multiSelect && answers[i].length > 1) || answers[i].some(v => typeof v !== 'string' || !v.trim())) throw new Error('答案格式不正确'); }
    this.trace(s, 'question', '已提交回答', answers.map(values => values.join('、')).join('；'), id);
    this.pending.get(id)?.resolve({ answers: answers.map(values => ({ values, note: '' })), cancelled: false }); this.pending.delete(id); s.questions = s.questions.filter(q => q.id !== id);
  }
  private releasePending(sessionId?: string) {
    for (const [id, p] of this.pending) if (!sessionId || sessionId === p.sessionId) { const s = this.state.sessions.find(s => s.id === p.sessionId); const isQuestion = s?.questions.some(q => q.id === id); p.resolve(isQuestion ? { cancelled: true, answers: [] } : { outcome: { outcome: 'cancelled' } }); this.pending.delete(id); }
    for (const s of this.state.sessions) if (!sessionId || sessionId === s.id) { s.permissions = []; s.questions = []; }
  }
  private async cancel() {
    const s = this.active(); if (!busy(s)) return; this.trace(s, 'cancel', '用户请求停止'); s.phase = 'cancelling'; this.emit();
    if (this.runtime) await this.runtime.agent.notify('session/cancel', { sessionId: s.id });
    else { this.demoAbort?.abort(); this.releasePending(s.id); }
  }
  private async demo(s: Session) {
    const abort = new AbortController(); this.demoAbort = abort;
    const wait = async (ms: number) => { await new Promise(r => setTimeout(r, ms)); if (abort.signal.aborted) throw new Error('cancelled'); };
    try {
      if (s.agentProfile === 'QA') {
        await wait(250);
        this.update({ sessionId: s.id, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '这是 QA 问答模式演示。真实 iCode 中，该 Agent 用于阅读代码并回答代码、架构和使用问题。本次没有调用模型、执行工具或生成文件变更。' } } });
        s.phase = 'completed'; return;
      }
      for (const text of ['这是交互演示，', '未调用模型，也不会修改项目文件。\n\n', s.approvalMode === 'manual' ? '下面将模拟一次工具审批，帮助你检查完整的任务流程。' : `当前为${s.approvalMode === 'auto' ? '自动审查' : '免审批'}模式，本次模拟操作直接通过（不执行真实安全评估）。`]) { await wait(250); this.update({ sessionId: s.id, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } }); }
      this.update({ sessionId: s.id, update: { sessionUpdate: 'tool_call', toolCallId: randomUUID(), title: '模拟读取项目结构', status: 'completed' } });
      if (s.approvalMode !== 'manual') this.trace(s, 'approval', `演示操作自动通过 · ${s.approvalMode}`);
      const response = s.approvalMode !== 'manual' ? { outcome: { optionId: 'allow' } } : await this.waitPermission({ sessionId: s.id, toolCall: { title: '模拟修改欢迎文案', rawInput: { path: 'demo/welcome.ts', action: '演示模式：不写入文件' } }, options: [{ optionId: 'allow', name: '允许本次演示', kind: 'allow_once' }, { optionId: 'reject', name: '拒绝', kind: 'reject_once' }] });
      if (abort.signal.aborted) { s.phase = 'cancelled'; return; }
      const allowed = response.outcome?.optionId === 'allow'; await wait(250);
      if (allowed) this.state.diffs = [{ path: 'demo/welcome.ts', before: 'export const title = "Hello";\n', after: 'export const title = "Hello, iCode";\n' }];
      this.update({ sessionId: s.id, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? '\n\n演示完成。右侧展示模拟 Diff，可切换文件前后版本。连接真实 iCode 后，这里将显示实际执行结果。' : '\n\n已拒绝模拟修改，没有生成变更。' } } }); s.phase = 'completed';
    } catch { s.phase = abort.signal.aborted ? 'cancelled' : 'failed'; }
    finally { this.demoAbort = undefined; }
  }
  async close() { this.demoAbort?.abort(); this.releasePending(); await this.runtime?.stop(); this.runtime = undefined; }
}
