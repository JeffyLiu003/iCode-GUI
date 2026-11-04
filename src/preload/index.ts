import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, State } from '../shared/types';
const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  command: command => ipcRenderer.invoke('command', command),
  exportSession: id => ipcRenderer.invoke('export-session', id),
  pickProject: () => ipcRenderer.invoke('pick-project'),
  subscribe: callback => { const listener = (_: unknown, state: State) => callback(state); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); },
};
contextBridge.exposeInMainWorld('desktop', api);
