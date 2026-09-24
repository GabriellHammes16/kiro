const { app, BrowserWindow, ipcMain, Menu, shell, dialog, protocol, safeStorage } = require('electron');
const ligacaoRede = require('../ligacao-rede-plugins.cjs');
const { criarGuardaDeSegredos } = require('../segredos-plugins.cjs');
const KiroPlugins = require('../plugins.js');
const { readFile, readdir, mkdir } = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { existsSync } = require('node:fs');
const { Vault, atomicWrite } = require('../vault.cjs');
const { AgentConfig } = require('../agent/index.cjs');
let vault, settings, primeiraVez = false;
// As imagens das notas chegam à janela por este esquema, servido pelo Vault: a página
// (file://) não lê o disco, e só arquivos de imagem de dentro do cofre passam.
// O código dos plug-ins chega ao worker pelo esquema kiro-plugin, também servido pelo Vault.
protocol.registerSchemesAsPrivileged([
  { scheme: 'kiro-anexo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  // corsEnabled: a página é file:// e o worker importa módulos deste esquema (import de módulo é CORS).
  { scheme: 'kiro-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
// Mesma CSP que o server.mjs manda com plugin-worker.js na versão web: é ela que corta a rede do worker.
const CSP_DO_WORKER = "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'";
// Host reservado para o código do próprio Kiro: tem ponto, e id de plug-in não pode ter
// (vault.pluginPath aceita só [a-z0-9-]), então nunca colide com a pasta de um plug-in.
const HOST_DO_KIRO = 'kiro.app';
const ARQUIVOS_DO_KIRO = new Set(['plugin-worker.js', 'plugins.js', 'kiro-frame.js']);
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
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Sem escolha salva e sem cofre na pasta padrão (nem na do KUROI): primeira abertura.
      // Nada é criado ainda; a tela de boas-vindas pergunta onde as notas vão ficar.
      primeiraVez = !existsSync(directory);
    }
  }
  vault = primeiraVez ? null : new Vault(directory);
  let agentConfig = primeiraVez ? null : new AgentConfig(directory);
  ipcMain.handle('vault:first-run', () => (primeiraVez ? { primeiraVez: true, padrao: directory } : { primeiraVez: false }));
  // Boas-vindas: 'padrao' usa Documentos/Kiro/vault; 'criar' e 'abrir' perguntam a pasta.
  ipcMain.handle('vault:setup', async (event, modo) => {
    if (!primeiraVez) throw new Error('O cofre já foi escolhido.');
    let pasta = directory;
    if (modo === 'criar' || modo === 'abrir') {
      const criar = modo === 'criar';
      const resultado = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: criar ? 'Onde criar o cofre do Kiro' : 'Abrir uma pasta de notas como cofre',
        buttonLabel: criar ? 'Criar cofre aqui' : 'Abrir cofre',
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (resultado.canceled || !resultado.filePaths[0]) return null;
      pasta = resultado.filePaths[0];
      // Criar numa pasta que já tem coisas (Documentos, por exemplo) não mistura as notas
      // com o resto: o cofre vira a subpasta "Kiro". Pasta vazia vira o próprio cofre.
      if (criar && (await readdir(pasta)).length) pasta = join(pasta, 'Kiro');
    } else if (modo !== 'padrao') throw new Error('Opção de cofre inválida.');
    const escolhido = new Vault(pasta);
    await escolhido.load();
    await atomicWrite(settings, JSON.stringify({ directory: escolhido.directory }));
    vault = escolhido;
    agentConfig = new AgentConfig(escolhido.directory);
    primeiraVez = false;
    return { directory: escolhido.directory };
  });
  ipcMain.handle('vault:load', () => {
    if (!vault) throw new Error('Escolha onde ficam suas notas para começar.');
    return vault.load();
  });
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
  // kiro-plugin://kiro.app/plugin-worker.js (e o plugins.js que ele importa) é o worker do Kiro;
  // qualquer outro host é o id do plug-in: kiro-plugin://word-count/index.js. Sem cabeçalho,
  // um worker file:// herdaria a CSP do index.html; servido daqui, vale a CSP da resposta.
  protocol.handle('kiro-plugin', async request => {
    try {
      const url = new URL(request.url);
      const arquivo = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (url.hostname === HOST_DO_KIRO && !ARQUIVOS_DO_KIRO.has(arquivo)) throw new Error('Arquivo do Kiro fora da lista.');
      const tipo = url.hostname === HOST_DO_KIRO ? 'text/javascript; charset=utf-8' : KiroPlugins.tipoDoArquivoDoPlugin(arquivo);
      let corpo = url.hostname === HOST_DO_KIRO ? await readFile(join(__dirname, '..', arquivo)) : await vault.readPluginFile(url.hostname, arquivo);
      const cabecalhos = { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP_DO_WORKER, 'Access-Control-Allow-Origin': '*' };
      // Tela de plug-in: sandbox e rede cortada na própria resposta, com o runtime do Kiro injetado.
      if (tipo.startsWith('text/html')) {
        corpo = KiroPlugins.injetarScriptsDaMoldura(corpo.toString('utf8'), `kiro-plugin://${HOST_DO_KIRO}/kiro-frame.js`);
        cabecalhos['Content-Security-Policy'] = KiroPlugins.cspDaMoldura('kiro-plugin:');
        cabecalhos['X-DNS-Prefetch-Control'] = 'off';
        delete cabecalhos['Access-Control-Allow-Origin'];
      }
      return new Response(corpo, { headers: cabecalhos });
    } catch { return new Response('Plug-in não encontrado.', { status: 404 }); }
  });
  // Plug-ins: a lista da pasta, as escolhas do usuário e o espaço de cada plug-in.
  // A versão do app é o que a página compara com o minKiro do manifesto.
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('plugins:list', () => vault.listPlugins());
  ipcMain.handle('plugins:choices:get', () => vault.readPluginChoices());
  ipcMain.handle('plugins:choices:set', (_event, escolhas) => vault.writePluginChoices(escolhas));
  ipcMain.handle('home:get', () => vault.readHomeLayout());
  ipcMain.handle('home:set', (_event, layout) => vault.writeHomeLayout(layout));
  ipcMain.handle('plugins:data:get', (_event, id) => vault.readPluginData(String(id || '')));
  ipcMain.handle('plugins:data:set', (_event, id, dados) => vault.writePluginData(String(id || ''), dados));
  // kiro.fetch e chaves: tudo é relido do cofre aberto (ligacao-rede-plugins.cjs); a página
  // só diz qual plug-in e o que ele pediu. Nenhum canal devolve o valor de uma chave.
  const guarda = criarGuardaDeSegredos({
    arquivo: join(app.getPath('userData'), 'plugin-secrets.json'),
    cifrar: v => safeStorage.encryptString(v).toString('base64'),
    decifrar: v => safeStorage.decryptString(Buffer.from(v, 'base64')),
  });
  const contextoDeRede = () => ({ vault, guarda, versaoDoKiro: app.getVersion() });
  ipcMain.handle('plugins:fetch', (_event, pluginId, pedido) => ligacaoRede.atenderFetch({ ...contextoDeRede(), pluginId, pedido }));
  ipcMain.handle('plugins:secrets:state', (_event, pluginId) => ligacaoRede.estadoDasChaves({ ...contextoDeRede(), pluginId }));
  ipcMain.handle('plugins:secrets:set', (_event, pluginId, nome, valor) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('A cifra do sistema não está disponível neste computador; a chave não foi gravada.');
    return ligacaoRede.gravarChave({ ...contextoDeRede(), pluginId, nome, valor });
  });
  ipcMain.handle('plugins:secrets:remove', (_event, pluginId, nome) => ligacaoRede.removerChave({ ...contextoDeRede(), pluginId, nome }));
  ipcMain.handle('vault:open', async () => { await mkdir(vault.directory, { recursive: true }); return shell.openPath(vault.directory); });
  // O caminho sai do cofre aberto, nunca da página.
  ipcMain.handle('plugins:open', async () => { const pasta = join(vault.directory, '.kiro', 'plugins'); await mkdir(pasta, { recursive: true }); return shell.openPath(pasta); });
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
