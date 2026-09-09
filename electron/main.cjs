const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const { readFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { Vault, atomicWrite } = require('../vault.cjs');
const { AgentConfig } = require('../agent/index.cjs');
let vault, settings;
function createWindow() {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 620, backgroundColor: '#0a0a0a', title: 'KUROI', icon: join(__dirname, '..', 'kuroi-logo-transparent.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(__dirname, 'preload.cjs') } });
  window.loadFile(join(__dirname, '..', 'index.html'));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  settings = join(app.getPath('userData'), 'vault-settings.json');
  let directory = join(app.getPath('documents'), 'KUROI', 'vault');
  try { directory = JSON.parse(await readFile(settings, 'utf8')).directory || directory; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  vault = new Vault(directory);
  let agentConfig = new AgentConfig(directory);
  ipcMain.handle('vault:load', () => vault.load());
  ipcMain.handle('vault:save', (_event, state) => vault.save(state));
  ipcMain.handle('vault:trash', () => vault.trash());
  ipcMain.handle('vault:open', async () => { await mkdir(vault.directory, { recursive: true }); return shell.openPath(vault.directory); });
  ipcMain.handle('vault:path', () => vault.directory);
  ipcMain.handle('agent:config:get', () => agentConfig.load());
  ipcMain.handle('agent:config:set', (_event, parcial) => agentConfig.save(parcial));
  ipcMain.handle('vault:choose', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Abrir pasta como cofre KUROI', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const selected = new Vault(result.filePaths[0]);
    const state = await selected.load();
    await atomicWrite(settings, JSON.stringify({ directory: selected.directory }));
    vault = selected;
    agentConfig = new AgentConfig(selected.directory);
    return state;
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { window.restore(); window.focus(); } });
}).catch(error => { dialog.showErrorBox('Não foi possível abrir o KUROI', error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
