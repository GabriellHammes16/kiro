import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import vaultModule from './vault.cjs';
import agentModule from './agent/index.cjs';
import ligacaoRede from './ligacao-rede-plugins.cjs';
import ligacaoPrevia from './ligacao-previa.cjs';
import segredosModule from './segredos-plugins.cjs';
import agendadorBackupModule from './agendador-backup.cjs';
import KiroPlugins from './plugins.js';
// Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
const frase = f => f;

const { Vault, ATTACHMENT_LIMIT } = vaultModule;
const root = dirname(fileURLToPath(import.meta.url));
// --dev: cofre de exemplo, recarga ao vivo e porta própria, para rodar junto do npm start.
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || (dev ? 4180 : 4173));
const vaultDirectory = process.env.KIRO_VAULT || process.env.KUROI_VAULT || join(root, dev ? 'dev-vault' : 'vault');
const vault = new Vault(vaultDirectory);
const devTools = dev ? (await import('./dev/devtools.mjs')).createDevTools(root) : null;
if (dev && !process.env.KIRO_VAULT && !process.env.KUROI_VAULT) await (await import('./dev/seed.cjs')).default.semearSeVazio(vaultDirectory);
const agentConfig = new agentModule.AgentConfig(vaultDirectory);
const publicFiles = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/idiomas.js': ['idiomas.js', 'text/javascript'], '/idiomas/en.js': ['idiomas/en.js', 'text/javascript'], '/corretor.js': ['corretor.js', 'text/javascript'], '/editor-nota.js': ['editor-nota.js', 'text/javascript'], '/editor-widgets.js': ['editor-widgets.js', 'text/javascript'], '/ortografia.js': ['ortografia.js', 'text/javascript'], '/domain.js': ['domain.js', 'text/javascript'], '/pdf-nota.js': ['pdf-nota.js', 'text/javascript'], '/plugins.js': ['plugins.js', 'text/javascript'], '/abas.js': ['abas.js', 'text/javascript'], '/fluxo.js': ['fluxo.js', 'text/javascript'], '/fluxo-tela.js': ['fluxo-tela.js', 'text/javascript'], '/previa-link.js': ['previa-link.js', 'text/javascript'],'/hoje.js': ['hoje.js', 'text/javascript'], '/icones-tema.js': ['icones-tema.js', 'text/javascript'], '/plugin-worker.js': ['plugin-worker.js', 'text/javascript'], '/kiro-frame.js': ['kiro-frame.js', 'text/javascript'],'/styles.css': ['styles.css', 'text/css'], '/temas.css': ['temas.css', 'text/css'],'/kiro-logo.png': ['kiro-logo.png', 'image/png'], '/kiro-abertura.png': ['kiro-abertura.png', 'image/png'] };
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// Corpo JSON com teto de tamanho: o erro sobe para o catch e vira 400.
const lerJson = async (request, limite) => {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error(frase('Use JSON.'));
  let bruto = '';
  for await (const parte of request) { bruto += parte; if (bruto.length > limite) throw new Error(frase('Pedido grande demais.')); }
  return JSON.parse(bruto || '{}');
};
// Chaves dos plug-ins na web: fora do cofre, sem cifra (limitação documentada na spec),
// arquivo só do dono. KIRO_SEGREDOS_ARQUIVO existe para os testes não tocarem a pasta real.
const arquivoDeSegredos = process.env.KIRO_SEGREDOS_ARQUIVO
  || (process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Kiro', 'plugin-secrets.json') : join(homedir(), '.config', 'Kiro', 'plugin-secrets.json'));
const guarda = segredosModule.criarGuardaDeSegredos({ arquivo: arquivoDeSegredos, cifrar: v => v, decifrar: v => v });
const arquivoDeBackup = process.env.KIRO_BACKUP_ARQUIVO
  || (process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Kiro', 'backup.json') : join(homedir(), '.config', 'Kiro', 'backup.json'));
const agendadorBackup = agendadorBackupModule.criarAgendadorDeBackup({ arquivo: arquivoDeBackup, obterCofre: () => vault });
agendadorBackup.iniciar();
// KIRO_REDE_FALSA=1 é só para os testes (tests/plugins-ligacao-rede.test.cjs): troca o
// transporte e o DNS por falsos que falham com o código KIRO_REDE_FALSA, sem abrir conexão
// nem resolver nome. A troca só tira capacidade: ligada por engano, o kiro.fetch apenas falha.
const falhaFalsa = () => Object.assign(new Error('rede falsa'), { code: 'KIRO_REDE_FALSA' });
const redeFalsa = process.env.KIRO_REDE_FALSA === '1' ? {
  requisitar: () => { const req = new EventEmitter(); req.end = () => process.nextTick(() => req.emit('error', falhaFalsa())); req.destroy = () => {}; return req; },
  lookup: (_host, _opcoes, cb) => cb(falhaFalsa()),
} : {};
// Rotas de rede e de chaves: só a própria página. Origin igual à do servidor, ou sem
// Origin (GET do navegador) mas com Sec-Fetch-Site: same-origin. Um site aberto no
// navegador não consegue usar o Kiro como ponte nem sondar as chaves.
const origensPermitidas = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
const mesmaOrigem = request => {
  const site = request.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  return request.headers.origin ? origensPermitidas.includes(request.headers.origin) : site === 'same-origin';
};
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!allowedHosts.has(request.headers.host)) return send(response, 403, { error: frase('Host não permitido.') });
  if (request.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(request.headers.origin)) return send(response, 403, { error: frase('Origem não permitida.') });
  try {
    if (request.url === '/api/state' && request.method === 'GET') return send(response, 200, await vault.load());
    if (request.url === '/api/conflicts' && request.method === 'GET') {
      if (!mesmaOrigem(request)) return send(response, 403, { error: frase('Origem não permitida.') });
      return send(response, 200, await vault.conflictCopies());
    }
    if (request.url === '/api/trash' && request.method === 'GET') return send(response, 200, await vault.trash());
    if (request.method === 'POST' && ['/api/history', '/api/history-read', '/api/history-restore'].includes(request.url)) {
      const pedido = await lerJson(request, 4096);
      return send(response, 200, await (request.url === '/api/history' ? vault.history(pedido) : request.url === '/api/history-read' ? vault.readHistory(pedido) : vault.restoreHistory(pedido)));
    }
    if (['/api/trash-purge', '/api/trash-empty'].includes(request.url) && request.method === 'POST') {
      const pedido = await lerJson(request, 4096);
      await (request.url === '/api/trash-purge' ? vault.purgeTrash(pedido) : vault.emptyTrash());
      return send(response, 200, { ok: true });
    }
    if (request.url === '/api/restore' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: frase('Use JSON.') });
      let bruto = ''; for await (const parte of request) { bruto += parte; if (bruto.length > 4096) return send(response, 413, { error: frase('Pedido grande demais.') }); }
      return send(response, 200, await vault.restore(JSON.parse(bruto)));
    }
    if (request.url === '/api/agent-config' && request.method === 'GET') return send(response, 200, await agentConfig.load());
    if (['/api/backup-status', '/api/backup-config', '/api/backup-run', '/api/backup-drive-connect', '/api/backup-drive-disconnect'].includes(request.url)) {
      if (!mesmaOrigem(request)) return send(response, 403, { error: frase('Só a própria página do Kiro pode usar esta rota.') });
      if (request.url === '/api/backup-status' && request.method === 'GET') return send(response, 200, await agendadorBackup.obterStatus());
      if (request.url === '/api/backup-config' && request.method === 'POST') return send(response, 200, await agendadorBackup.salvarConfig(await lerJson(request, 8192)));
      if (request.url === '/api/backup-run' && request.method === 'POST') return send(response, 200, await agendadorBackup.executarAgora(await lerJson(request, 1024)));
      if (request.url === '/api/backup-drive-connect' && request.method === 'POST') return send(response, 200, await agendadorBackup.conectarGoogleDrive({ ...(await lerJson(request, 4096)), aguardar: false }));
      if (request.url === '/api/backup-drive-disconnect' && request.method === 'POST') return send(response, 200, await agendadorBackup.desconectarGoogleDrive());
      return send(response, 404, { error: frase('Não encontrado.') });
    }
    if (request.url === '/api/agent-config' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: frase('Use JSON.') });
      let bruto = ''; for await (const parte of request) { bruto += parte; if (bruto.length > 8192) return send(response, 413, { error: frase('Configuração grande demais.') }); }
      return send(response, 200, await agentConfig.save(JSON.parse(bruto)));
    }
    if ((request.url === '/api/state' || request.url === '/api/state?parcial=1') && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: frase('Use JSON.') });
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 20 * 1024 * 1024) return send(response, 413, { error: frase('Backup maior que 20 MB.') }); chunks.push(chunk); }
      const salvo = await vault.save(JSON.parse(Buffer.concat(chunks).toString('utf8')), { copiaParcial: request.url.endsWith('?parcial=1') });
      agendadorBackup.aoSalvar();
      return send(response, 200, salvo);
    }
    if (devTools && request.url === '/dev/events' && request.method === 'GET') return devTools.eventos(request, response);
    if (devTools && request.url === '/dev/reload.js' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(await devTools.script());
    }
    if (request.url === '/api/anexo' && request.method === 'POST') {
      // O tipo declarado só filtra o pedido; o Vault confere a imagem pelo conteúdo.
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf','audio/wav','audio/x-wav','audio/mpeg','audio/webm','text/plain','text/csv','text/markdown','audio/mp4','audio/x-m4a','video/mp4'].includes(request.headers['content-type']?.split(';')[0])) return send(response, 415, { error: frase('Envie uma imagem, PDF, áudio, vídeo, texto ou tabela suportados.') });
      let tamanho = 0; const partes = [];
      for await (const parte of request) { tamanho += parte.length; if (tamanho > ATTACHMENT_LIMIT) return send(response, 413, { error: frase('Imagem maior que 250 MB.') }); partes.push(parte); }
      let nome = ''; try { nome = decodeURIComponent(request.headers['x-kiro-nome'] || ''); } catch { /* nome ilegível: a imagem recebe um nome gerado */ }
      return send(response, 200, await vault.saveAttachment({ name: nome, data: Buffer.concat(partes) }));
    }
    // Sem a query: a recarga de estilo pede styles.css?v=<hora> para furar o cache.
    const rota = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && rota.startsWith('/anexo/')) {
      try {
        // Com Range (o <video> pede trechos) só o trecho sai do disco; sem ele, o arquivo inteiro.
        const relativo = rota.slice('/anexo/'.length).split('/').map(decodeURIComponent).join('/'), range = request.headers.range;
        let parte;
        if (range) parte = await vault.readAttachmentRange(relativo, range);
        else { const { data, type } = await vault.readAttachment(relativo); parte = { type, ...vaultModule.attachmentRange(data, null) }; }
        const cspAnexo = parte.type === 'application/pdf' ? "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'" : "default-src 'none'";
        response.writeHead(parte.status, { 'Content-Type': parte.type, 'Cache-Control': 'no-cache', 'Content-Security-Policy': cspAnexo,...parte.headers });
        return response.end(parte.data);
      } catch { return send(response, 404, { error: frase('Imagem não encontrada.') }); }
    }
    // KaTeX embarcado: só os três tipos de arquivo que a página pede.
    const katex = rota.match(/^\/vendor\/katex\/(katex\.min\.(?:js|css)|fonts\/KaTeX_[A-Za-z0-9-]+\.woff2)$/);
    if (request.method === 'GET' && katex) {
      try {
        const corpo = await readFile(join(root, 'vendor', 'katex', ...katex[1].split('/')));
        const tipo = katex[1].endsWith('.js') ? 'text/javascript' : katex[1].endsWith('.css') ? 'text/css' : 'font/woff2';
        response.writeHead(200, { 'Content-Type': `${tipo}; charset=utf-8`, 'Cache-Control': 'max-age=86400' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Arquivo não encontrado.') }); }
    }
    // PDF.js: a biblioteca e o worker que rasterizam o PDF da nota em pixels (pdf-nota.js).
    const pdfjs = rota.match(/^\/vendor\/pdfjs\/pdf(\.worker)?\.min\.js$/);
    if (request.method === 'GET' && pdfjs) {
      try {
        const corpo = await readFile(join(root, 'vendor', 'pdfjs', `pdf${pdfjs[1] || ''}.min.js`));
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Arquivo não encontrado.') }); }
    }
    // CodeMirror 6 embarcado: um arquivo só, gerado por scripts/build-codemirror.mjs.
    if (request.method === 'GET' && rota === '/vendor/codemirror/codemirror.js') {
      try {
        const corpo = await readFile(join(root, 'vendor', 'codemirror', 'codemirror.js'));
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Arquivo não encontrado.') }); }
    }
    // Hunspell embarcado: motor em WebAssembly.
    if (request.method === 'GET' && rota === '/vendor/hunspell/hunspell.js') {
      try {
        const corpo = await readFile(join(root, 'vendor', 'hunspell', 'hunspell.js'));
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Arquivo não encontrado.') }); }
    }
    // Dicionários embarcados: um por idioma, gerados por scripts/build-ortografia.mjs — vendor/dicionarios/
    const dicionario = rota.match(/^\/vendor\/dicionarios\/([a-z]{2}-[A-Z]{2})\.js$/);
    if (request.method === 'GET' && dicionario) {
      try {
        const corpo = await readFile(join(root, 'vendor', 'dicionarios', `${dicionario[1]}.js`));
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Arquivo não encontrado.') }); }
    }
    // Fontes embarcadas: nome fixo, sem caminho, e só .woff2 de dentro de fonts/.
    if (request.method === 'GET' && /^\/fonts\/[a-z0-9-]+\.woff2$/.test(rota)) {
      try {
        const corpo = await readFile(join(root, 'fonts', rota.slice('/fonts/'.length)));
        response.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Fonte não encontrada.') }); }
    }
    // Dados dos plug-ins: a lista da pasta, as escolhas do usuário e o espaço de
    // cada plug-in. Quem decide o que carregar é a página; aqui só se lê e grava.
    if (rota === '/api/version' && request.method === 'GET') return send(response, 200, { version });
    if (rota === '/api/plugins' && request.method === 'GET') return send(response, 200, await vault.listPlugins());
    if (rota === '/api/plugin-inspect' && request.method === 'POST') {
      if (!mesmaOrigem(request)) return send(response, 403, { error: frase('Origem não permitida.') });
      const { id } = await lerJson(request, 4096);
      return send(response, 200, await vault.inspectPlugin(id));
    }
    if (rota === '/api/plugin-choices') {
      if (request.method === 'GET') return send(response, 200, await vault.readPluginChoices());
      if (request.method === 'POST') return send(response, 200, await vault.writePluginChoices(await lerJson(request, 64 * 1024)));
    }
    if (rota === '/api/home-layout') {
      if (request.method === 'GET') return send(response, 200, await vault.readHomeLayout());
      if (request.method === 'POST') return send(response, 200, await vault.writeHomeLayout(await lerJson(request, 256 * 1024)));
    }
    if (rota === '/api/favoritos') {
      if (request.method === 'GET') return send(response, 200, await vault.readBookmarks());
      if (request.method === 'POST') return send(response, 200, await vault.writeBookmarks(await lerJson(request, 256 * 1024)));
    }
    if (rota === '/api/dicionario') {
      if (request.method === 'GET') return send(response, 200, await vault.readDictionary());
      if (request.method === 'POST') {
        if (!mesmaOrigem(request)) return send(response, 403, { error: frase('Só a própria página do Kiro pode usar esta rota.') });
        return send(response, 200, await vault.addToDictionary(String((await lerJson(request, 4096))?.palavra ?? '')));
      }
    }
    if (rota.startsWith('/api/plugin-data/')) {
      const id = decodeURIComponent(rota.slice('/api/plugin-data/'.length));
      if (request.method === 'GET') return send(response, 200, await vault.readPluginData(id));
      if (request.method === 'POST') return send(response, 200, await vault.writePluginData(id, await lerJson(request, 1024 * 1024)));
    }
    // Prévia de link do Fluxo: mesma busca do Electron; qualquer falha volta como null.
    if (rota === '/api/previa' && request.method === 'POST') {
      if (!mesmaOrigem(request)) return send(response, 403, { error: frase('Só a própria página do Kiro pode usar esta rota.') });
      const { url } = await lerJson(request, 4096);
      return send(response, 200, typeof url === 'string' ? await ligacaoPrevia.buscarPrevia({ vault, url, ...redeFalsa }) : null);
    }
    // kiro.fetch e chaves: a página não é confiável; ligacao-rede-plugins.cjs relê tudo do cofre.
    if (rota === '/api/plugin-fetch' || rota.startsWith('/api/plugin-secrets/')) {
      if (!mesmaOrigem(request)) return send(response, 403, { error: frase('Só a própria página do Kiro pode usar esta rota.') });
      const contexto = { vault, guarda, versaoDoKiro: version };
      try {
        if (rota === '/api/plugin-fetch') {
          if (request.method !== 'POST') return send(response, 404, { error: frase('Não encontrado.') });
          const { pluginId, pedido } = await lerJson(request, 3 * 1024 * 1024);
          return send(response, 200, await ligacaoRede.atenderFetch({ ...contexto, ...redeFalsa, pluginId, pedido }));
        }
        const pluginId = decodeURIComponent(rota.slice('/api/plugin-secrets/'.length));
        if (request.method === 'GET') return send(response, 200, await ligacaoRede.estadoDasChaves({ ...contexto, pluginId }));
        if (request.method === 'POST') { const { name, value } = await lerJson(request, 16 * 1024); return send(response, 200, await ligacaoRede.gravarChave({ ...contexto, pluginId, nome: name, valor: value })); }
        if (request.method === 'DELETE') { const { name } = await lerJson(request, 4096); return send(response, 200, await ligacaoRede.removerChave({ ...contexto, pluginId, nome: name })); }
        return send(response, 404, { error: frase('Não encontrado.') });
      } catch (erro) { return send(response, erro.status || 400, { error: erro.message }); }
    }
    // Código e tela do plug-in: só .js/.html/.css de dentro de .kiro/plugins. O .js segue
    // com a CSP do worker (rede cortada); o .html vira moldura isolada com o runtime injetado.
    if (rota.startsWith('/plugins/')) {
      const partes = rota.slice('/plugins/'.length).split('/');
      if (request.method !== 'GET' || partes.length !== 2) return send(response, 404, { error: frase('Não encontrado.') });
      try {
        const id = decodeURIComponent(partes[0]), arquivo = decodeURIComponent(partes[1]);
        const tipo = KiroPlugins.tipoDoArquivoDoPlugin(arquivo);
        let corpo = await vault.readPluginFile(id, arquivo);
        const cabecalhos = { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'" };
        // Tela de plug-in: sandbox e rede cortada na própria resposta, com o runtime do Kiro injetado.
        if (tipo.startsWith('text/html')) {
          const origem = `http://${request.headers.host}`;   // já conferido em allowedHosts
          corpo = KiroPlugins.injetarScriptsDaMoldura(corpo.toString('utf8'), '/kiro-frame.js');
          cabecalhos['Content-Security-Policy'] = KiroPlugins.cspDaMoldura(origem);
          cabecalhos['X-DNS-Prefetch-Control'] = 'off';
        }
        response.writeHead(200, cabecalhos);
        return response.end(corpo);
      } catch { return send(response, 404, { error: frase('Plug-in não encontrado.') }); }
    }
    const file = publicFiles[rota];
    if (request.method !== 'GET' || !file) return send(response, 404, { error: frase('Não encontrado.') });
    let body = await readFile(join(root, file[0]));
    if (devTools && file[0] === 'index.html') body = devTools.injetar(body.toString('utf8'));
    // Quem manda no worker é a CSP do arquivo do worker, não a do plug-in importado:
    // é aqui que a rede do plug-in morre.
    const cabecalhos = { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' };
    if (file[0] === 'plugin-worker.js') cabecalhos['Content-Security-Policy'] = "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'";
    response.writeHead(200, cabecalhos);
    response.end(body);
  } catch (error) { send(response, 400, { error: error.message }); }
}).listen(port, '127.0.0.1', () => console.log(dev ? `Kiro em desenvolvimento: http://localhost:${port} · cofre ${vaultDirectory}` : `Kiro em http://localhost:${port}`));
