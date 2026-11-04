export type ApprovalMode = 'manual' | 'auto' | 'bypass';
export type Phase = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export type TraceEvent = { id: string; time: number; kind: 'run' | 'tool' | 'approval' | 'question' | 'error' | 'cancel' | 'mode'; title: string; detail?: string; referenceId?: string };
export type AgentProfile = { name: string; displayName: string; description: string };
export type Turn = { agentProfile?: string; id: string; prompt: string; startedAt: number; finishedAt?: number; phase: Phase; model: string; approvalMode: ApprovalMode; events: TraceEvent[]; diffs: Diff[] };
export type Message = { id: string; role: 'user' | 'assistant' | 'tool'; text: string; status?: string; turnId?: string; time?: number };
export type Permission = { id: string; title: string; details: string; options: { optionId: string; name: string; kind: string }[] };
export type Question = { id: string; questions: { question: string; options: { label: string; description?: string }[]; multiSelect?: boolean }[] };
export type Session = { agentProfile?: string; agentChanges?: { time: number; from: string; to: string }[]; id: string; title: string; customTitle?: string; archived: boolean; pinned: boolean; draft: string; turns: Turn[]; diffs: Diff[]; messages: Message[]; phase: Phase; permissions: Permission[]; questions: Question[]; updatedAt: number; approvalMode: ApprovalMode; approvalModes: ApprovalMode[]; skills?: { name: string; description: string }[] };
export type Diff = { path: string; before: string; after: string };
export type WorkspaceInfo = { displayName?: string; archived?: boolean; removed?: boolean; path: string; collapsed: boolean; sessionCount: number; sessions?: { id: string; title: string }[] };
export type State = { fontSize: number; mode: 'demo' | 'live'; connection: 'disconnected' | 'connecting' | 'ready' | 'error'; project: string; executable: string; sessions: Session[]; activeId: string | null; diffs: Diff[]; error: string; storageError: string; transitioning: boolean; logs: string[]; runtimeVersion: string; models: { id: string; name: string }[]; modelId: string; approvalMode: ApprovalMode; workspaces: WorkspaceInfo[]; agents: AgentProfile[]; agentError: string; syncedAt?: number; syncSummary?: string };
export type WorkspaceData = { project: string; mode: State['mode']; sessions: Session[]; activeId: string | null };
export type SavedData = { fontSize?: number; version: 1; project: string; mode: State['mode']; executable: string; workspaces: WorkspaceInfo[]; buckets: WorkspaceData[] };
export type Command =
 | { type: 'renameWorkspace'; path: string; name: string } | { type: 'archiveWorkspace'; path: string; archived: boolean } | { type: 'removeWorkspace'; path: string } | { type: 'restoreWorkspace'; path: string }
 | { type: 'fontSize'; size: number }
 | { type: 'connect'; mode: 'demo' | 'live'; executable: string; approvalMode?: ApprovalMode }
 | { type: 'syncSessions' } | { type: 'openRemoteSession'; path: string; id: string }
 | { type: 'agent'; name: string } | { type: 'refreshAgents' } | { type: 'skills' } | { type: 'clearError' } | { type: 'newSession' } | { type: 'selectSession'; id: string }
 | { type: 'renameSession'; id: string; title: string } | { type: 'archiveSession'; id: string; archived: boolean }
 | { type: 'pinSession'; id: string; pinned: boolean } | { type: 'deleteSession'; id: string }
 | { type: 'draft'; id: string; text: string } | { type: 'workspace'; path: string } | { type: 'collapseWorkspace'; path: string; collapsed: boolean }
 | { type: 'prompt'; text: string } | { type: 'cancel' }
 | { type: 'permission'; id: string; optionId: string }
 | { type: 'answer'; id: string; answers: string[][] }
 | { type: 'model'; id: string } | { type: 'approvalMode'; mode: ApprovalMode };
export type DesktopAPI = { snapshot(): Promise<State>; command(command: Command): Promise<void>; pickProject(): Promise<void>; exportSession(id: string): Promise<boolean>; subscribe(callback: (state: State) => void): () => void };
declare global { interface Window { desktop: DesktopAPI } }
