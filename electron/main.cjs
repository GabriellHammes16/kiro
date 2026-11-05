const { app, BrowserWindow, ipcMain, Menu, shell, dialog, protocol, safeStorage, globalShortcut, nativeTheme } = require('electron');
const ligacaoRede = require('../ligacao-rede-plugins.cjs');
const { buscarPrevia } = require('../ligacao-previa.cjs');
const { criarGuardaDeSegredos } = require('../segredos-plugins.cjs');
const { criarAgendadorDeBackup } = require('../agendador-backup.cjs');
const KiroPlugins = require('../plugins.js');
const { readFile, readdir, mkdir, copyFile } = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { existsSync, readFileSync } = require('node:fs');
const { release } = require('node:os');
const { Vault, atomicWrite } = require('../vault.cjs');
const { palavraValida, palavraParaDicionario } = require('../corretor.js');
const { instalarPluginsInclusos } = require('./plugins-inclusos.cjs');
// Corretor: português e inglês juntos (a palavra vale se estiver certa em um dos dois).
const IDIOMAS_DO_CORRETOR = ['pt-BR', 'en-US'];
const { AgentConfig } = require('../agent/index.cjs');
const KiroIdiomas = require('../idiomas.js');
KiroIdiomas.registrar('en', require('../idiomas/en.js'));
// frase() só marca a mensagem para a página traduzir (aqui ela segue em português); t() traduz na hora.
const { t, frase } = KiroIdiomas;
let vault, settings, primeiraVez = false;
// As imagens das notas chegam à janela por este esquema, servido pelo Vault: a página
// (file://) não lê o disco, e só arquivos de imagem de dentro do cofre passam.
// O código dos plug-ins chega ao worker pelo esquema kiro-plugin, também servido pelo Vault.
protocol.registerSchemesAsPrivileged([
  // corsEnabled: o PDF.js faz fetch do documento (pdf-nota.js) e a página é file://,
  // origem cruzada — sem o privilégio o Chromium corta o pedido antes do esquema.
  { scheme: 'kiro-anexo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  // corsEnabled: a página é file:// e o worker importa módulos deste esquema (import de módulo é CORS).
  { scheme: 'kiro-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
// Mesma CSP que o server.mjs manda com plugin-worker.js na versão web: é ela que corta a rede do worker.
const CSP_DO_WORKER = "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'";
// Host reservado para o código do próprio Kiro: tem ponto, e id de plug-in não pode ter
// (vault.pluginPath aceita só [a-z0-9-]), então nunca colide com a pasta de um plug-in.
const HOST_DO_KIRO = 'kiro.app';
const ARQUIVOS_DO_KIRO = new Set(['plugin-worker.js', 'plugins.js', 'kiro-frame.js', 'vendor/pdfjs/pdf.worker.min.js']);
// Janela como a do Obsidian (Windows): sem a barra de título do sistema; os botões de minimizar,
// maximizar e fechar são os do sistema, desenhados por cima da faixa do app e pintados com as cores
// do tema (a página manda as cores por 'janela:cores'). No macOS e no Linux fica a janela padrão: no
// Linux a barra sobreposta depende do tema GTK e do compositor (borda branca, falhas no Wayland).
const JANELA_PROPRIA = process.platform === 'win32';
const ALTURA_DA_BARRA = 32;
// Vidro (tema Liquid Glass): janela transparente de verdade, para o desktop aparecer atrás do véu que o
// controle de transparência regula. O estilo original pede o desfoque do sistema (a página não enxerga o
// desktop, então backdrop-filter não o alcança); o estilo escuro deixa o desktop nítido.
// `transparent` só vale na criação: trocar o tema recria a janela, e a escolha fica em janela.json.
const VIDRO_NATIVO = process.platform === 'darwin' || process.platform === 'win32';
// O acrylic pelo Electron exige o Windows 11 22H2 (build 22621); sem ele o desktop fica nítido atrás do véu.
const DESFOQUE_NATIVO = process.platform === 'darwin' || (process.platform === 'win32' && Number(release().split('.')[2]) >= 22621);
// Só liga: no Windows, o material "none" deixa a janela transparente opaca; desligar recria a janela.
const janelasDesfocadas = new WeakSet();
function ligarDesfoque(janela) {
  janelasDesfocadas.add(janela);
  if (process.platform === 'darwin') janela.setVibrancy('under-window');
  else janela.setBackgroundMaterial('acrylic');
}
const janelasDeVidro = new WeakSet();
// O acrylic pinta a janela inteira: numa janela `transparent`, que é quadrada, ele sobra nas pontas do recorte
// por CSS. Sem `transparent`, o Windows arredonda a janela e o acrylic juntos. Sem acrylic, segue o recorte.
const CANTOS_DO_SISTEMA = process.platform === 'win32' && DESFOQUE_NATIVO;
const janelasComCantos = new WeakSet();
const arquivoDoVidro = () => join(app.getPath('userData'), 'janela.json');
function janelaSalva() {
  try { return JSON.parse(readFileSync(arquivoDoVidro(), 'utf8')) || {}; } catch { return {}; }
}
const vidroSalvo = () => janelaSalva().vidro === true;
const cantosSalvos = () => janelaSalva().cantos === true;
function opcoesDoVidro(vidro, cantos = false) {
  if (!vidro || !VIDRO_NATIVO) return { backgroundColor: '#0a0a0a' };
  return cantos ? { backgroundColor: '#00000000' } : { transparent: true, backgroundColor: '#00000000' };
}
// Dicionários embutidos (dicionarios/*.bdic) vão para a pasta onde o Chromium os procura, então
// ele não baixa nada. Sem a pasta (corretor do sistema), só ativa os idiomas.
async function prepararCorretor(sessao) {
  const embutidos = join(__dirname, '..', 'dicionarios');
  if (existsSync(embutidos)) {
    const destino = join(app.getPath('userData'), 'Dictionaries');
    await mkdir(destino, { recursive: true });
    for (const arquivo of (await readdir(embutidos)).filter(a => a.endsWith('.bdic')))
      if (!existsSync(join(destino, arquivo))) await copyFile(join(embutidos, arquivo), join(destino, arquivo));
  }
  const idiomas = IDIOMAS_DO_CORRETOR.filter(i => sessao.availableSpellCheckerLanguages.includes(i));
  if (idiomas.length) sessao.setSpellCheckerLanguages(idiomas); // vazio: fica o padrão do sistema
}
// Fechar com algo não salvo: a página tenta gravar e, se conseguir, a janela fecha sem perguntar nada.
// Só quando não dá para gravar (erro, formulário aberto) a pessoa decide. Vale só para fechar: 'close' vem antes do beforeunload.
const respostasDoFechar = new WeakMap();
ipcMain.on('janela:resposta-fechar', (evento, ok) => respostasDoFechar.get(evento.sender)?.(ok === true));
function gravacaoAoFechar(janela) {
  const conteudo = janela.webContents;
  return new Promise(resolver => {
    const limite = setTimeout(() => resolver(false), 8000);
    respostasDoFechar.set(conteudo, ok => { clearTimeout(limite); respostasDoFechar.delete(conteudo); resolver(ok); });
    conteudo.send('janela:salvar-e-fechar');
  });
}
function fecharSemPerderNada(janela) {
  let querFechar = false, tratando = false;
  janela.on('close', () => { querFechar = true; });
  janela.webContents.on('will-prevent-unload', async () => {
    if (!querFechar || tratando) return;
    querFechar = false; tratando = true;
    try {
      const gravou = await gravacaoAoFechar(janela);
      if (janela.isDestroyed()) return;
      if (gravou) { tratando = false; return void janela.close(); }
      const { response } = await dialog.showMessageBox(janela, { type: 'warning', title: 'Kiro', message: t('Há alterações que não puderam ser salvas.'), detail: t('Se fechar agora, elas serão perdidas.'), buttons: [t('Continuar editando'), t('Fechar sem salvar')], defaultId: 0, cancelId: 0, noLink: true });
      if (response === 1 && !janela.isDestroyed()) janela.destroy();
    } finally { tratando = false; }
  });
}
const WM_SYSCOMMAND = 0x0112, SC_MAXIMIZE = 0xF030;
function createWindow(vidro = vidroSalvo(), limites = {}, cantos = vidro && CANTOS_DO_SISTEMA && cantosSalvos()) {
  const window = new BrowserWindow({ width: 1280, height: 820, ...limites, minWidth: 900, minHeight: 620, ...opcoesDoVidro(vidro, cantos), title: 'Kiro',
    ...(JANELA_PROPRIA ? { titleBarStyle: 'hidden', titleBarOverlay: { color: vidro && VIDRO_NATIVO ? '#00000000' : '#111111', symbolColor: '#EDEDED', height: ALTURA_DA_BARRA } } : {}), icon: join(__dirname, '..', 'kiro-logo.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(__dirname, 'preload.cjs') } });
  if (vidro && VIDRO_NATIVO) janelasDeVidro.add(window);
  if (cantos) {
    janelasComCantos.add(window);
    ligarDesfoque(window); // sem transparent, nasceria preta até a página pedir
    // Sem foco, o Windows troca o acrylic por uma cor lisa; reaplicar mantém o vidro, sem piscar (passar por "none" pisca).
    window.on('blur', () => { if (!window.isDestroyed()) window.setBackgroundMaterial('acrylic'); });
  } else if (vidro && process.platform === 'win32') {
    // Janela transparente: o Windows ignora o duplo clique na barra, mas maximize() funciona.
    window.hookWindowMessage(WM_SYSCOMMAND, parametro => {
      if ((parametro.readUInt32LE(0) & 0xFFF0) === SC_MAXIMIZE) window.isMaximized() ? window.unmaximize() : window.maximize();
    });
  }
  window.loadFile(join(__dirname, '..', 'index.html'));
  // Depois da página, para não atrasar a abertura. A sessão vem de antes: a página pode pedir outro tipo de
  // janela enquanto carrega, e esta já estaria destruída quando o evento chegasse.
  const sessao = window.webContents.session;
  // A página é file://, sem Referer: o player do YouTube recusa (erro 153). Só o embed recebe um Referer de aplicativo.
  sessao.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (detalhes, retorno) => retorno({ requestHeaders: { ...detalhes.requestHeaders, Referer: 'https://kiro.app/' } }));
  window.webContents.once('did-finish-load', () => prepararCorretor(sessao).catch(() => { /* sem corretor, o app segue */ }));
  // Botão direito num campo de texto: a página abre o próprio menu com a palavra e as sugestões.
  window.webContents.on('context-menu', (_evento, p) => {
    if (p.isEditable) window.webContents.send('corretor:menu', { palavra: p.misspelledWord || '', sugestoes: (p.dictionarySuggestions || []).slice(0, 5) });
  });
  fecharSemPerderNada(window);
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  return window;
}
// No Linux, o registro do Chromium (inclui erros do console da página) vai para ~/.config/kiro/kiro.log,
// recriado a cada abertura: é o que se pede a quem relata um problema numa distro que não temos.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-logging', 'file');
  app.commandLine.appendSwitch('log-file', join(app.getPath('userData'), 'kiro.log'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  KiroIdiomas.definirIdioma(KiroIdiomas.detectar(app.getLocale())); // caixas de erro de partida; a página manda o idioma escolhido
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
  const agendadorBackup = criarAgendadorDeBackup({
    arquivo: join(app.getPath('userData'), 'backup.json'),
    obterCofre: () => vault,
    cifrar: v => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString('base64') : v),
    decifrar: v => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : v),
    abrirUrl: url => shell.openExternal(url),
  });
  agendadorBackup.iniciar();
  ipcMain.handle('vault:first-run', () => (primeiraVez ? { primeiraVez: true, padrao: directory } : { primeiraVez: false }));
  // Boas-vindas: 'padrao' usa Documentos/Kiro/vault; 'criar' e 'abrir' perguntam a pasta.
  ipcMain.handle('vault:setup', async (event, modo) => {
    if (!primeiraVez) throw new Error(frase('O cofre já foi escolhido.'));
    let pasta = directory;
    if (modo === 'criar' || modo === 'abrir') {
      const criar = modo === 'criar';
      const resultado = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: criar ? t('Onde criar o cofre do Kiro') : t('Abrir uma pasta de notas como cofre'),
        buttonLabel: criar ? t('Criar cofre aqui') : t('Abrir cofre'),
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (resultado.canceled || !resultado.filePaths[0]) return null;
      pasta = resultado.filePaths[0];
      // Criar numa pasta que já tem coisas (Documentos, por exemplo) não mistura as notas
      // com o resto: o cofre vira a subpasta "Kiro". Pasta vazia vira o próprio cofre.
      if (criar && (await readdir(pasta)).length) pasta = join(pasta, 'Kiro');
    } else if (modo !== 'padrao') throw new Error(frase('Opção de cofre inválida.'));
    const escolhido = new Vault(pasta);
    await escolhido.load();
    await atomicWrite(settings, JSON.stringify({ directory: escolhido.directory }));
    vault = escolhido;
    agentConfig = new AgentConfig(escolhido.directory);
    primeiraVez = false;
    agendadorBackup.iniciar();
    return { directory: escolhido.directory };
  });
  ipcMain.handle('vault:load', () => {
    if (!vault) throw new Error(frase('Escolha onde ficam suas notas para começar.'));
    return vault.load();
  });
  ipcMain.handle('vault:save', async (_event, state, opcoes) => { const salvo = await vault.save(state, { copiaParcial: opcoes?.copiaParcial === true }); agendadorBackup.aoSalvar(); return salvo; });
  ipcMain.handle('vault:conflicts', () => vault ? vault.conflictCopies() : []);
  ipcMain.handle('captura-global', (_event, ligado) => {
    const tecla = 'CommandOrControl+Shift+Space';
    globalShortcut.unregister(tecla);
    if (!ligado) return true;
    try { return globalShortcut.register(tecla, () => { const janela = BrowserWindow.getAllWindows()[0]; if (!janela) return; if (janela.isMinimized()) janela.restore(); janela.show(); janela.focus(); janela.webContents.send('captura-global'); }); } catch { return false; }
  });
  ipcMain.handle('nota:imprimir', event => new Promise((resolve, reject) => {
    if (event.senderFrame !== event.sender.mainFrame) return reject(new Error(frase('Pedido de impressão inválido.')));
    event.sender.print({ silent: false, printBackground: false }, (sucesso, motivo) => {
      if (sucesso || motivo === 'Print job canceled') resolve(sucesso);
      else reject(new Error(frase('Não foi possível imprimir ou exportar esta nota.')));
    });
  }));
  ipcMain.handle('nota:pdf', async (event, titulo) => {
    if (event.senderFrame !== event.sender.mainFrame || typeof titulo !== 'string') throw new Error(frase('Pedido de impressão inválido.'));
    const nome = titulo.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 100) || 'nota';
    const resultado = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: t('Exportar nota para PDF'), defaultPath: `${nome}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (resultado.canceled || !resultado.filePath) return false;
    const dados = await event.sender.printToPDF({ printBackground: false, pageSize: 'A4' });
    await atomicWrite(resultado.filePath, dados);
    return true;
  });
  ipcMain.handle('vault:trash', () => vault.trash());
  ipcMain.handle('vault:restore', (_event, pedido) => vault.restore(pedido));
  ipcMain.handle('vault:trash-purge', (_event, pedido) => vault.purgeTrash(pedido));
  ipcMain.handle('vault:trash-empty', () => vault.emptyTrash());
  ipcMain.handle('vault:history', (_event, pedido) => vault.history(pedido));
  ipcMain.handle('vault:history-read', (_event, pedido) => vault.readHistory(pedido));
  ipcMain.handle('vault:history-restore', (_event, pedido) => vault.restoreHistory(pedido));
  ipcMain.handle('vault:attachment', (_event, pedido) => {
    if (!(pedido?.dados instanceof Uint8Array)) throw new Error(frase('Imagem inválida.'));
    return vault.saveAttachment({ name: String(pedido.nome || ''), data: Buffer.from(pedido.dados) });
  });
  // Botão "Abrir" de um PDF na nota: o leitor do sistema abre o arquivo do cofre.
  // O caminho passa pela mesma contenção de readAttachment (extensão e safePath).
  ipcMain.handle('vault:open-attachment', async (_event, caminho) => {
    const relativo = String(caminho || '');
    if (!/\.(png|jpe?g|gif|webp|avif|bmp|pdf|txt|csv|mp3|wav|webm|m4a|mp4)$/i.test(relativo)) throw new Error(frase('Imagem inválida.'));
    return shell.openPath(await vault.safePath(relativo));
  });
  // `vault` é lido a cada pedido: depois de escolher outro cofre, as imagens vêm do novo.
  protocol.handle('kiro-anexo', async request => {
    try {
      const relativo = new URL(request.url).pathname.slice(1).split('/').map(decodeURIComponent).join('/');
      const { data, type } = await vault.readAttachment(relativo);
      // CORS porque o PDF.js faz fetch do documento e a página é file:// (esquema cruzado);
      // o esquema serve só anexos do cofre, como o kiro-plugin já faz.
      const parte = require('../vault.cjs').attachmentRange(data, request.headers.get('range'));
      return new Response(parte.data, { status: parte.status, headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', ...parte.headers } });
    } catch { return new Response('Imagem não encontrada.', { status: 404 }); }
  });
  // kiro-plugin://kiro.app/plugin-worker.js (e o plugins.js que ele importa) é o worker do Kiro;
  // qualquer outro host é o id do plug-in: kiro-plugin://flashcards/index.js. Sem cabeçalho,
  // um worker file:// herdaria a CSP do index.html; servido daqui, vale a CSP da resposta.
  protocol.handle('kiro-plugin', async request => {
    try {
      const url = new URL(request.url);
      const arquivo = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (url.hostname === HOST_DO_KIRO && !ARQUIVOS_DO_KIRO.has(arquivo)) throw new Error(frase('Arquivo do Kiro fora da lista.'));
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
  // Corretor ortográfico e idioma: o que a página manda é validado aqui.
  ipcMain.on('idioma:definir', (_event, codigo) => KiroIdiomas.definirIdioma(String(codigo || '')));
  ipcMain.on('corretor:definir', (event, ligado) => event.sender.session.setSpellCheckerEnabled(ligado === true));
  ipcMain.on('corretor:trocar', (event, palavra) => { if (palavraValida(palavra)) event.sender.replaceMisspelling(palavra); });
  ipcMain.on('corretor:adicionar', (event, palavra) => { if (palavraParaDicionario(palavra)) event.sender.session.addWordToSpellCheckerDictionary(palavra); });
  // A nova janela nasce no lugar da antiga (antes de fechá-la, senão o app encerra) e recarrega a página.
  ipcMain.handle('janela:vidro', async (event, ligado, comDesfoque) => {
    const janela = BrowserWindow.fromWebContents(event.sender);
    const vidro = ligado === true && VIDRO_NATIVO;
    const desfoque = vidro && comDesfoque === true && DESFOQUE_NATIVO;
    const cantos = desfoque && CANTOS_DO_SISTEMA;
    if (vidro !== vidroSalvo() || cantos !== cantosSalvos()) await atomicWrite(arquivoDoVidro(), JSON.stringify({ vidro, cantos }));
    if (janela && (janelasDeVidro.has(janela) !== vidro || janelasComCantos.has(janela) !== cantos || (janelasDesfocadas.has(janela) && !desfoque))) {
      const nova = createWindow(vidro, janela.getNormalBounds(), cantos);
      if (janela.isMaximized()) nova.maximize();
      janela.destroy();
    } else if (janela && desfoque && !janelasDesfocadas.has(janela)) ligarDesfoque(janela); // recriada: a página nova pede de novo
    return { ativo: vidro, desfoque, cantos };
  });
  // O tom do sistema é o que tinge o acrylic. Reaplicar o material faz a troca valer na hora, sem passar por "none", que pisca.
  ipcMain.on('janela:tom-do-vidro', (event, tom) => {
    if (!['light', 'dark', 'system'].includes(tom) || nativeTheme.themeSource === tom) return;
    nativeTheme.themeSource = tom;
    const janela = BrowserWindow.fromWebContents(event.sender);
    if (janela && janelasDesfocadas.has(janela) && process.platform !== 'darwin') janela.setBackgroundMaterial('acrylic');
  });
  // Cores dos botões da janela: só as duas cores, validadas, para a janela que pediu.
  ipcMain.on('janela:cores', (event, cores) => {
    const cor = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
    const janela = BrowserWindow.fromWebContents(event.sender);
    const fundo = cor(cores?.fundo), simbolo = cor(cores?.simbolo);
    if (JANELA_PROPRIA && janela && fundo && simbolo) janela.setTitleBarOverlay({ color: cores.vidro === true && VIDRO_NATIVO ? '#00000000' : fundo, symbolColor: simbolo, height: ALTURA_DA_BARRA });
  });
  ipcMain.handle('plugins:list', async () => {
    const atual = vault;
    if (!atual) return [];
    const origem = app.isPackaged ? join(process.resourcesPath, 'plugins') : join(__dirname, '..', 'examples', 'plugins');
    await instalarPluginsInclusos(atual, origem);
    return atual.listPlugins();
  });
  ipcMain.handle('plugins:choices:get', () => vault.readPluginChoices());
  ipcMain.handle('plugins:inspect', (_event, id) => vault.inspectPlugin(id));
  ipcMain.handle('plugins:choices:set', (_event, escolhas) => vault.writePluginChoices(escolhas));
  ipcMain.handle('home:get', () => vault.readHomeLayout());
  ipcMain.handle('home:set', (_event, layout) => vault.writeHomeLayout(layout));
  ipcMain.handle('favoritos:get', () => vault.readBookmarks());
  ipcMain.handle('favoritos:set', (_event, favoritos) => vault.writeBookmarks(favoritos));
  ipcMain.handle('dicionario:get', () => vault.readDictionary());
  ipcMain.handle('dicionario:add', (_event, palavra) => vault.addToDictionary(palavra));
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
  // Prévia de link do Fluxo: a busca e a gravação da imagem acontecem aqui; a página só passa o endereço.
  ipcMain.handle('fluxo:previa', (_event, url) => buscarPrevia({ vault, url }));
  ipcMain.handle('plugins:secrets:state', (_event, pluginId) => ligacaoRede.estadoDasChaves({ ...contextoDeRede(), pluginId }));
  ipcMain.handle('plugins:secrets:set', (_event, pluginId, nome, valor) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error(frase('A cifra do sistema não está disponível neste computador; a chave não foi gravada.'));
    return ligacaoRede.gravarChave({ ...contextoDeRede(), pluginId, nome, valor });
  });
  ipcMain.handle('plugins:secrets:remove', (_event, pluginId, nome) => ligacaoRede.removerChave({ ...contextoDeRede(), pluginId, nome }));
  ipcMain.handle('vault:open', async () => { await mkdir(vault.directory, { recursive: true }); return shell.openPath(vault.directory); });
  // O caminho sai do cofre aberto, nunca da página.
  ipcMain.handle('plugins:open', async () => { const pasta = join(vault.directory, '.kiro', 'plugins'); await mkdir(pasta, { recursive: true }); return shell.openPath(pasta); });
  ipcMain.handle('vault:path', () => vault.directory);
  ipcMain.handle('agent:config:get', () => agentConfig.load());
  ipcMain.handle('agent:config:set', (_event, parcial) => agentConfig.save(parcial));
  ipcMain.handle('backup:status', () => agendadorBackup.obterStatus());
  ipcMain.handle('backup:config:set', (_event, parcial) => agendadorBackup.salvarConfig(parcial));
  ipcMain.handle('backup:run', (_event, opcoes) => agendadorBackup.executarAgora(opcoes));
  ipcMain.handle('backup:choose', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: t('Escolher pasta de destino do backup'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return agendadorBackup.salvarConfig({ destino: result.filePaths[0] });
  });
  ipcMain.handle('backup:open', async () => {
    const status = await agendadorBackup.obterStatus();
    if (status.config.modo === 'nuvem') {
      await shell.openExternal(await agendadorBackup.urlPastaNaNuvem());
      return '';
    }
    return shell.openPath(await agendadorBackup.pastaDoCofreNoDestino());
  });
  ipcMain.handle('backup:drive:connect', (_event, credenciais) => agendadorBackup.conectarGoogleDrive(credenciais));
  ipcMain.handle('backup:drive:disconnect', () => agendadorBackup.desconectarGoogleDrive());
  ipcMain.handle('vault:choose', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: t('Abrir pasta como cofre Kiro'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const selected = new Vault(result.filePaths[0]);
    const state = await selected.load();
    await atomicWrite(settings, JSON.stringify({ directory: selected.directory }));
    vault = selected;
    agentConfig = new AgentConfig(selected.directory);
    agendadorBackup.iniciar();
    return state;
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { window.restore(); window.focus(); } });
}).catch(error => { dialog.showErrorBox(t('Não foi possível abrir o Kiro'), error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
