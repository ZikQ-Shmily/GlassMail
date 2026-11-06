const { contextBridge, ipcRenderer } = require('electron');
const invoke = name => (...args) => ipcRenderer.invoke(`glassmail:${name}`, ...args);
contextBridge.exposeInMainWorld('glassmail', {
  desktop: true, platform: process.platform,
  ...Object.fromEntries(['state','saveAccount','deleteAccount','testAccount','saveRule','deleteRule','settings','sync','acknowledge','markAllRead','exportConfig','importConfig','chooseSound','clearHistory','windowAction'].map(name => [name, invoke(name)])),
  onState: callback => { const fn = (_, state) => callback(state); ipcRenderer.on('glassmail:state', fn); return () => ipcRenderer.removeListener('glassmail:state', fn); },
  onAlert: callback => { const fn = (_, alert) => callback(alert); ipcRenderer.on('glassmail:alert', fn); return () => ipcRenderer.removeListener('glassmail:alert', fn); }
});
