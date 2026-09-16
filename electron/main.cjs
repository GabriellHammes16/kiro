const { app, BrowserWindow, ipcMain, Menu, shell, dialog, protocol } = require('electron');
const { readFile, mkdir } = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { existsSync } = require('node:fs');
const { Vault, atomicWrite } = require('../vault.cjs');
const { AgentConfig } = require('../agent/index.cjs');
let vault, settings;
// As imagens das notas chegam à janela por este esquema, servido pelo Vault: a página
// (file://) não lê o disco, e só arquivos de imagem de dentro do cofre passam.
protocol.registerSchemesAsPrivileged([{ scheme: 'kiro-anexo', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
function createWindow() {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 620, backgroundColor: '#0a0a0a', title: 'Kiro', icon: join(__dirname, '..', 'kiro-logo.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(__dirname, 'preload.cjs') } });
  window.loadFile(join(__dirname, '..', 'index.html'));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  settings = join(app.getPath('userData'), 'vault-settings.json');
  // Instalação que veio do KUROI: a escolha de cofre está na pasta com o nome antigo.
  const settingsAntigo = join(dirname(app.getPath('userData')), 'KUROI', 'vault-settings.json');
  if (!existsSync(settings) && existsSync(settingsAntigo)) settings = settingsAntigo;
  let directory = join(app.getPath('documents'), 'Kiro', 'vault');
  if (!existsSync(directory) && existsSync(join(app.getPath('documents'), 'KUROI', 'vault'))) directory = join(app.getPath('documents'), 'KUROI', 'vault');
  // npm run desktop:dev abre o cofre de exemplo sem mexer no cofre salvo.
  // Só no código-fonte: o aplicativo empacotado ignora a opção e nem traz dev/.
  if (!app.isPackaged && process.argv.includes('--dev-vault')) {
    const { DEV_VAULT, semearSeVazio } = require('../dev/seed.cjs');
    await semearSeVazio();
    directory = DEV_VAULT;
  } else {
    try { directory = JSON.parse(await readFile(settings, 'utf8')).directory || directory; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  vault = new Vault(directory);
  let agentConfig = new AgentConfig(directory);
  ipcMain.handle('vault:load', () => vault.load());
  ipcMain.handle('vault:save', (_event, state) => vault.save(state));
  ipcMain.handle('vault:trash', () => vault.trash());
  ipcMain.handle('vault:restore', (_event, pedido) => vault.restore(pedido));
  ipcMain.handle('vault:attachment', (_event, pedido) => {
    if (!(pedido?.dados instanceof Uint8Array)) throw new Error('Imagem inválida.');
    return vault.saveAttachment({ name: String(pedido.nome || ''), data: Buffer.from(pedido.dados) });
  });
  // `vault` é lido a cada pedido: depois de escolher outro cofre, as imagens vêm do novo.
  protocol.handle('kiro-anexo', async request => {
    try {
      const relativo = new URL(request.url).pathname.slice(1).split('/').map(decodeURIComponent).join('/');
      const { data, type } = await vault.readAttachment(relativo);
      return new Response(data, { headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Imagem não encontrada.', { status: 404 }); }
  });
  ipcMain.handle('vault:open', async () => { await mkdir(vault.directory, { recursive: true }); return shell.openPath(vault.directory); });
  ipcMain.handle('vault:path', () => vault.directory);
  ipcMain.handle('agent:config:get', () => agentConfig.load());
  ipcMain.handle('agent:config:set', (_event, parcial) => agentConfig.save(parcial));
  ipcMain.handle('vault:choose', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Abrir pasta como cofre Kiro', properties: ['openDirectory', 'createDirectory'] });
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
}).catch(error => { dialog.showErrorBox('Não foi possível abrir o Kiro', error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
