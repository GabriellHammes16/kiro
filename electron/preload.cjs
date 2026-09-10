const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cadernoDesktop', {
  loadState: () => ipcRenderer.invoke('vault:load'),
  saveState: state => ipcRenderer.invoke('vault:save', state),
  openVault: () => ipcRenderer.invoke('vault:open'),
  vaultPath: () => ipcRenderer.invoke('vault:path'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  trash: () => ipcRenderer.invoke('vault:trash'),
  restore: pedido => ipcRenderer.invoke('vault:restore', pedido),
  agentConfig: () => ipcRenderer.invoke('agent:config:get'),
  saveAgentConfig: parcial => ipcRenderer.invoke('agent:config:set', parcial)
});
