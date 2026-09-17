const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cadernoDesktop', {
  loadState: () => ipcRenderer.invoke('vault:load'),
  saveState: state => ipcRenderer.invoke('vault:save', state),
  openVault: () => ipcRenderer.invoke('vault:open'),
  openPluginsFolder: () => ipcRenderer.invoke('plugins:open'),
  vaultPath: () => ipcRenderer.invoke('vault:path'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  trash: () => ipcRenderer.invoke('vault:trash'),
  restore: pedido => ipcRenderer.invoke('vault:restore', pedido),
  saveAttachment: pedido => ipcRenderer.invoke('vault:attachment', pedido),
  agentConfig: () => ipcRenderer.invoke('agent:config:get'),
  saveAgentConfig: parcial => ipcRenderer.invoke('agent:config:set', parcial),
  version: () => ipcRenderer.invoke('app:version'),
  plugins: () => ipcRenderer.invoke('plugins:list'),
  pluginChoices: () => ipcRenderer.invoke('plugins:choices:get'),
  savePluginChoices: escolhas => ipcRenderer.invoke('plugins:choices:set', escolhas),
  pluginData: id => ipcRenderer.invoke('plugins:data:get', id),
  savePluginData: (id, dados) => ipcRenderer.invoke('plugins:data:set', id, dados),
  pluginFetch: (id, pedido) => ipcRenderer.invoke('plugins:fetch', id, pedido),
  pluginSecrets: id => ipcRenderer.invoke('plugins:secrets:state', id),
  savePluginSecret: (id, nome, valor) => ipcRenderer.invoke('plugins:secrets:set', id, nome, valor),
  removePluginSecret: (id, nome) => ipcRenderer.invoke('plugins:secrets:remove', id, nome)
});
