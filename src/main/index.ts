import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { discoverICodeWorkspaces } from './workspace-discovery';
import { LocalStore } from './local-store';
import { Controller } from './controller';
import { validateCommand } from '../shared/validation';
let win: BrowserWindow | null = null;
let controller: Controller;
let quitting = false;
// Test profiles are isolated by --user-data-dir; production launches share one writer.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on('second-instance', () => { win?.restore(); win?.show(); win?.focus(); });
let store: LocalStore;
const devURL = process.env.ICODE_GUI_DEV_URL;
app.whenReady().then(async () => {
  if (!hasLock) return;
  const settingsFile = join(app.getPath('userData'), 'workspace.json');
  const dataPath = join(app.getPath('userData'), 'sessions-v1.json');
  store = new LocalStore(dataPath, message => { controller.state.storageError = message; win?.webContents.send('state', controller.state); });
  controller = new Controller(state => { win?.webContents.send('state', state); }, () => store.schedule(() => controller.exportData()), () => discoverICodeWorkspaces(process.env.ICODE_GUI_CONFIG_DIR));
  const saved = store.read();
  try {
    if (saved) controller.restore(saved);
    else { const preferences = JSON.parse(readFileSync(settingsFile, 'utf8')); if (typeof preferences.project === 'string' && preferences.project) await controller.project(preferences.project); if (typeof preferences.executable === 'string') controller.state.executable = preferences.executable; }
  } catch (error) {
    if (saved) { copyFileSync(dataPath, dataPath + `.invalid-${Date.now()}.bak`); controller.state.storageError = `历史数据校验失败，已备份：${String(error)}`; }
  }
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('请求来源无效');
  };
  ipcMain.handle('snapshot', event => { authorize(event); return controller.state; });
  ipcMain.handle('command', async (event, command: unknown) => { authorize(event); await controller.command(validateCommand(command)); });
  ipcMain.handle('pick-project', async event => {
    authorize(event); const result = await dialog.showOpenDialog(win!, { title: '选择工作项目', properties: ['openDirectory'] });
    if (!result.canceled && result.filePaths[0]) await controller.project(resolve(result.filePaths[0]));
  });
  ipcMain.handle('export-session', async (event, id: unknown) => {
    authorize(event); if (typeof id !== 'string' || id.length > 4096) throw new Error('会话标识无效');
    const data = controller.sessionExport(id);
    const name = (data.session.customTitle ?? data.session.title).replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
    const result = await dialog.showSaveDialog(win!, { title: '导出会话与任务轨迹', defaultPath: name + '.json', filters: [{ name: 'JSON 会话记录', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), { mode: 0o600 }); return true;
  });
  const create = () => {
    win = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 700, title: 'iCode', backgroundColor: '#fafbf9', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 }, webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => { win = null; });
    if (devURL) void win.loadURL(devURL); else void win.loadFile(join(__dirname, '../renderer/index.html'));
  };
  create();
  if (controller.state.mode === 'live' && controller.state.project) void controller.command({ type: 'syncSessions' }).catch(() => {});
  app.on('activate', () => { if (!win) create(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !controller) return;
  event.preventDefault(); quitting = true;
  void controller.close().finally(() => { store.schedule(() => controller.exportData()); store.flush(); app.quit(); });
});
