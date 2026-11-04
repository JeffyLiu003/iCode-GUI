import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { client, ndJsonStream, PROTOCOL_VERSION, type ClientConnection, type ClientContext, type RequestPermissionResponse } from '@agentclientprotocol/sdk/unstable';
export type Json = Record<string, any>;
export type Callbacks = { update: (params: Json) => void; permission: (params: Json, signal?: AbortSignal) => Promise<Json>; question: (params: Json, signal?: AbortSignal) => Promise<Json>; log: (line: string) => void; disconnected: (reason: string) => void };
export class AcpRuntime {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: ClientConnection;
  private closing = false;
  capabilities: Json = {};
  get agent(): ClientContext { if (!this.connection) throw new Error('iCode 尚未连接'); return this.connection.agent; }
  async start(executable: string, cwd: string, cb: Callbacks, approvalMode = 'manual') {
    this.closing = false;
    const program = executable === 'icode' && existsSync(join(homedir(), '.local', 'bin', 'icode')) ? join(homedir(), '.local', 'bin', 'icode') : !isAbsolute(executable) && /[\\/]/.test(executable) ? resolve(cwd, executable) : executable;
    const child = spawn(program, ['acp', '--agent', 'Code', '--approval', approvalMode, '--workdir', cwd], { cwd: homedir(), shell: false, stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
    this.process = child;
    child.stderr.on('data', (chunk) => { for (const line of String(chunk).split(/\r?\n/)) if (line) cb.log(line.slice(0, 2000)); });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.on('error', error => { if (!this.closing) cb.disconnected(error.message); });
    child.on('exit', (code, signal) => { if (!this.closing) cb.disconnected(`iCode 已退出（${signal ?? code}）`); });
    const app = client({ name: 'icode-gui' });
    app.onNotification('session/update', ({ params }) => cb.update(params));
    app.onNotification('*', ({ params, method }) => { cb.update({ ...(params as Json), _method: method }); });
    app.onRequest('session/request_permission', async ({ params, signal }) => await cb.permission(params, signal) as RequestPermissionResponse);
    app.onRequest('_chrys/request_input', (params: unknown) => params as Json, async ({ params, signal }) => await cb.question(params, signal));
    this.connection = app.connect(ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>));
    this.connection.closed.then(() => { if (!this.closing) cb.disconnected('ACP 连接已关闭，请重新连接并恢复会话。'); }).catch(() => {});
    const result = await this.request<Json>('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: 'icode-gui', version: '0.2.0' } });
    this.capabilities = result.agentCapabilities ?? {};
    return result.agentInfo?.version ?? 'unknown';
  }
  async request<T = Json>(method: string, params: Json, timeoutMs = 20000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.agent.request<T, Json>(method, params), new Promise<never>((_, reject) => { timer = setTimeout(() => { this.connection?.close(); reject(new Error(`ACP 请求超时：${method}；请重新连接核对状态`)); }, timeoutMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  extension(method: string, params: Json, timeoutMs?: number) { return this.request(`_${method}`, params, timeoutMs); }
  private killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
        killer.on('error', () => child.kill(signal));
      } else process.kill(-child.pid, signal);
    } catch { try { child.kill(signal); } catch { /* Already exited. */ } }
  }
  async stop() {
    this.closing = true;
    this.connection?.close(); this.connection = undefined;
    const child = this.process; this.process = undefined;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    await Promise.race([new Promise<void>(r => child.once('exit', () => r())), new Promise<void>(r => setTimeout(r, 1500))]);
    if (child.exitCode === null) this.killTree(child, 'SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) this.killTree(child, 'SIGKILL'); }, 1500); timer.unref();
  }
}
