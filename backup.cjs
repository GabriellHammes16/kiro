// Backup automático do cofre numa pasta escolhida pelo usuário (normalmente a do Google
// Drive para Desktop, que cuida do envio para a nuvem). Duas partes independentes:
//   espelho/  cópia viva das notas e anexos, arquivos soltos e legíveis (fonte para o NotebookLM)
//   copias/   um .zip datado do cofre inteiro por período, com as antigas apagadas pelo limite
// Só Node, sem Electron e sem dependências: o mesmo código serve ao desktop e à versão web.
// Regra de segurança: nada é apagado fora de <destino>/Kiro/<cofre>/, e só se a marca existir.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
// Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
const frase = f => f;

const deflateRaw = promisify(zlib.deflateRaw);
const TIPOS = ['horas', 'diaria', 'semanal', 'mensal'];
const MARCA = '.kiro-backup';
const MANTER_MANUAL = 10;
// Arquivos até este tamanho são lidos com o cofre parado (fila do Vault): a cópia fica coerente.
// Os maiores (anexos, que nunca são reescritos) são lidos depois, sem segurar os salvamentos.
const LEITURA_COERENTE = 8 * 1024 * 1024;
// Já comprimidos: deflate só gastaria tempo.
const SEM_COMPRESSAO = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.pdf', '.mp3', '.webm', '.mp4', '.zip', '.gz']);
const EXCLUIR_DA_COPIA = new Set(['.kiro.lock', '.trash', '.history']);

const LIMITES = { intervalo: [1, 24], horas: [1, 48], diaria: [1, 60], semanal: [1, 52], mensal: [1, 36] };
const configPadrao = () => ({
  ligado: false,
  modo: 'pasta',
  destino: '',
  nuvem: { clientId: '', email: '' },
  espelho: true,
  copias: {
    horas: { ligado: false, intervalo: 6, manter: 8 },
    diaria: { ligado: true, manter: 7 },
    semanal: { ligado: true, dia: 0, manter: 4 },
    mensal: { ligado: true, manter: 12 },
  },
});
const inteiro = (valor, [min, max], padrao) => { const n = Math.round(Number(valor)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };

/** Aceita qualquer coisa vinda da página e devolve uma configuração completa e válida. */
function normalizarConfig(entrada = {}) {
  const base = configPadrao(), e = entrada && typeof entrada === 'object' ? entrada : {};
  const c = e.copias && typeof e.copias === 'object' ? e.copias : {};
  const n = e.nuvem && typeof e.nuvem === 'object' ? e.nuvem : {};
  const config = {
    ligado: e.ligado === true,
    modo: e.modo === 'nuvem' ? 'nuvem' : 'pasta',
    destino: typeof e.destino === 'string' ? e.destino.trim().slice(0, 1024) : '',
    nuvem: {
      clientId: typeof n.clientId === 'string' ? n.clientId.trim().slice(0, 256) : '',
      email: typeof n.email === 'string' ? n.email.trim().slice(0, 256) : '',
    },
    espelho: e.espelho === undefined ? base.espelho : e.espelho === true,
    copias: {},
  };
  for (const tipo of TIPOS) {
    const atual = c[tipo] && typeof c[tipo] === 'object' ? c[tipo] : {}, padrao = base.copias[tipo];
    const item = { ligado: atual.ligado === undefined ? padrao.ligado : atual.ligado === true, manter: inteiro(atual.manter, LIMITES[tipo], padrao.manter) };
    if (tipo === 'horas') item.intervalo = inteiro(atual.intervalo, LIMITES.intervalo, padrao.intervalo);
    if (tipo === 'semanal') item.dia = inteiro(atual.dia, [0, 6], padrao.dia);
    config.copias[tipo] = item;
  }
  return config;
}

// ---- Datas (horário local) ----
const dois = n => String(n).padStart(2, '0');
const chaveDoDia = d => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const inicioDoDia = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Quais cópias estão vencidas agora. `ultimas` guarda a hora (ms) da última de cada tipo. */
function copiasAtrasadas(config, ultimas = {}, agora = new Date()) {
  const vencidas = [];
  for (const tipo of TIPOS) {
    const item = config.copias[tipo], ultima = Number(ultimas[tipo]) || 0;
    if (!item.ligado) continue;
    let limite;
    if (tipo === 'horas') limite = agora.getTime() - item.intervalo * 3600e3 + 60e3;   // 1 min de folga para o relógio do timer
    else if (tipo === 'diaria') limite = inicioDoDia(agora);
    else if (tipo === 'semanal') { const atras = (agora.getDay() - item.dia + 7) % 7; limite = inicioDoDia(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - atras)); }
    else limite = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
    if (ultima < limite) vencidas.push(tipo);
  }
  return vencidas;
}

/** Nome do .zip: a ordem alfabética é a ordem das datas, e isso a rotação usa. */
function nomeDaCopia(tipo, d) {
  const dia = chaveDoDia(d), hora = `${dois(d.getHours())}${dois(d.getMinutes())}`;
  if (tipo === 'horas') return `kiro-${dia}_${hora}.zip`;
  if (tipo === 'mensal') return `kiro-${dia.slice(0, 7)}.zip`;
  if (tipo === 'manual') return `kiro-${dia}_${hora}${dois(d.getSeconds())}.zip`;
  return `kiro-${dia}.zip`;
}

// ---- Caminhos ----
const NO_WINDOWS = process.platform === 'win32';
const comparavel = p => (NO_WINDOWS ? path.resolve(p).toLowerCase() : path.resolve(p));
const dentro = (filho, pai) => { const r = path.relative(comparavel(pai), comparavel(filho)); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };
const nomeDePasta = nome => nome.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || 'cofre';

async function lerMarca(pasta) {
  try { return JSON.parse(await fs.readFile(path.join(pasta, MARCA), 'utf8')); } catch { return null; }
}
async function vazia(pasta) {
  try { return (await fs.readdir(pasta)).length === 0; } catch (erro) { if (erro.code === 'ENOENT') return true; throw erro; }
}

/**
 * Confere o destino e devolve a pasta deste cofre dentro dele, criando-a com a marca.
 * Pasta já existente só é usada se for deste cofre (marca) ou estiver vazia.
 */
async function resolverRaiz(cofre, destino) {
  if (typeof destino !== 'string' || !destino.trim()) throw new Error(frase('Escolha a pasta de destino do backup.'));
  if (!path.isAbsolute(destino)) throw new Error(frase('A pasta de destino precisa ser um caminho completo.'));
  if (dentro(destino, cofre)) throw new Error(frase('O destino do backup não pode ficar dentro do cofre.'));
  if (dentro(cofre, destino)) throw new Error(frase('O cofre não pode ficar dentro da pasta de destino do backup.'));
  let info;
  try { info = await fs.stat(destino); } catch { throw new Error(frase('A pasta de destino não está disponível. Confira se o Google Drive (ou o disco) está conectado.')); }
  if (!info.isDirectory()) throw new Error(frase('O destino do backup precisa ser uma pasta.'));
  const destinoReal = await fs.realpath(destino), cofreReal = await fs.realpath(cofre);
  if (dentro(destinoReal, cofreReal)) throw new Error(frase('O destino do backup não pode ficar dentro do cofre.'));
  if (dentro(cofreReal, destinoReal)) throw new Error(frase('O cofre não pode ficar dentro da pasta de destino do backup.'));
  const base = path.join(destinoReal, 'Kiro'), nome = nomeDePasta(path.basename(cofreReal));
  const sufixo = createHash('sha256').update(comparavel(cofreReal)).digest('hex').slice(0, 6);
  for (const candidato of [nome, `${nome}-${sufixo}`]) {
    const raiz = path.join(base, candidato), marca = await lerMarca(raiz);
    if (marca ? comparavel(marca.cofre || '') === comparavel(cofreReal) : await vazia(raiz)) {
      await fs.mkdir(raiz, { recursive: true });
      if (!marca) await escreverAtomico(path.join(raiz, MARCA), JSON.stringify({ cofre: cofreReal, criadoEm: new Date().toISOString(), aviso: 'Pasta gerenciada pelo backup do Kiro. Arquivos aqui dentro podem ser substituídos ou apagados.' }, null, 2));
      return raiz;
    }
  }
  throw new Error(frase('Já existe no destino uma pasta de backup de outro cofre com este nome.'));
}

// ---- Arquivos ----
async function comRepeticao(operacao) {
  // O Google Drive para Desktop prende arquivos por instantes enquanto envia.
  for (let tentativa = 0; ; tentativa++) {
    try { return await operacao(); } catch (erro) {
      if (tentativa >= 4 || !['EBUSY', 'EPERM', 'EACCES'].includes(erro.code)) throw erro;
      await new Promise(r => setTimeout(r, 250 * (tentativa + 1)));
    }
  }
}
async function escreverAtomico(arquivo, conteudo) {
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${randomUUID().slice(0, 8)}.tmp`;
  try { await fs.writeFile(temporario, conteudo); await comRepeticao(() => fs.rename(temporario, arquivo)); }
  finally { await fs.rm(temporario, { force: true }); }
}
async function copiarAtomico(origem, alvo, mtimeMs) {
  await fs.mkdir(path.dirname(alvo), { recursive: true });
  const temporario = `${alvo}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await fs.copyFile(origem, temporario);
    await fs.utimes(temporario, new Date(), new Date(mtimeMs));
    await comRepeticao(() => fs.rename(temporario, alvo));
  } finally { await fs.rm(temporario, { force: true }); }
}

/** Lista arquivos (sem seguir links simbólicos). `aceitar(rel, nome, ehPasta)` filtra. */
async function listar(raiz, aceitar = () => true) {
  const achados = [];
  const andar = async rel => {
    let entradas;
    try { entradas = await fs.readdir(rel ? path.join(raiz, ...rel.split('/')) : raiz, { withFileTypes: true }); }
    catch (erro) { if (erro.code === 'ENOENT') return; throw erro; }
    for (const entrada of entradas) {
      if (entrada.isSymbolicLink()) continue;
      const caminho = rel ? `${rel}/${entrada.name}` : entrada.name;
      if (!aceitar(caminho, entrada.name, entrada.isDirectory())) continue;
      if (entrada.isDirectory()) await andar(caminho);
      else if (entrada.isFile()) {
        const abs = path.join(raiz, ...caminho.split('/'));
        try { const info = await fs.stat(abs); achados.push({ rel: caminho, abs, size: info.size, mtimeMs: info.mtimeMs }); }
        catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
      }
    }
  };
  await andar('');
  return achados;
}
const temporario = nome => /\.tmp$/i.test(nome);
// Espelho: só o que é conteúdo. Nada oculto (histórico, lixeira, plug-ins, marcas) e sem caderno.json.
const paraEspelho = (rel, nome) => !nome.startsWith('.') && !temporario(nome) && rel !== 'caderno.json';
// Cópia: o cofre inteiro, menos a trava, a lixeira, o histórico (a própria cópia já é histórico) e temporários.
const paraCopia = (rel, nome) => !temporario(nome) && !(rel === nome && EXCLUIR_DA_COPIA.has(nome));
const chaveDoArquivo = rel => (NO_WINDOWS ? rel.toLowerCase() : rel);

async function removerPastasVazias(raiz, rel = '') {
  const pasta = rel ? path.join(raiz, rel) : raiz;
  let entradas;
  try { entradas = await fs.readdir(pasta, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) if (e.isDirectory() && !e.isSymbolicLink()) await removerPastasVazias(raiz, rel ? path.join(rel, e.name) : e.name);
  if (rel && (await vazia(pasta))) await fs.rmdir(pasta).catch(() => {});
}

/** Atualiza <raiz>/espelho com as notas e anexos do cofre: copia o que mudou e tira o que sumiu. */
async function espelhar(cofre, raiz) {
  if (!(await lerMarca(raiz))) throw new Error(frase('A pasta de backup perdeu a marca .kiro-backup; nada foi alterado.'));
  const destino = path.join(raiz, 'espelho');
  const origem = await listar(cofre, paraEspelho);
  const existentes = await listar(destino);
  // Cofre vazio (disco desmontado, pasta trocada): apagar o espelho inteiro seria o pior desfecho.
  if (!origem.length && existentes.length) throw new Error(frase('O cofre parece vazio; o espelho não foi alterado para não apagar a cópia.'));
  const noDestino = new Map(existentes.map(f => [chaveDoArquivo(f.rel), f]));
  let copiados = 0, removidos = 0;
  const manter = new Set();
  for (const f of origem) {
    const chave = chaveDoArquivo(f.rel), atual = noDestino.get(chave);
    manter.add(chave);
    if (atual && atual.size === f.size && Math.abs(atual.mtimeMs - f.mtimeMs) < 2000) continue;
    try { await copiarAtomico(f.abs, path.join(destino, ...f.rel.split('/')), f.mtimeMs); copiados++; }
    catch (erro) { if (erro.code !== 'ENOENT') throw erro; manter.delete(chave); }   // apagado no meio do caminho
  }
  for (const f of existentes) if (!manter.has(chaveDoArquivo(f.rel))) { await comRepeticao(() => fs.rm(f.abs, { force: true })); removidos++; }
  await removerPastasVazias(destino);
  return { copiados, removidos, total: origem.length };
}

// ---- ZIP (formato clássico, sem ZIP64) ----
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = typeof zlib.crc32 === 'function' ? dados => zlib.crc32(dados) >>> 0 : dados => { let c = 0xffffffff; for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function horaDos(mtimeMs) {
  const d = new Date(mtimeMs), ano = Math.min(2107, Math.max(1980, d.getFullYear()));
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
const GRANDE_DEMAIS = () => new Error(frase('O cofre passou de 4 GB ou de 65 mil arquivos; a cópia em .zip não é possível.'));

/** Grava um .zip em `arquivo`. `entradas`: [{ nome, mtimeMs, ler: async () => Buffer | null }]. */
async function gravarZip(arquivo, entradas) {
  const handle = await fs.open(arquivo, 'wx');
  const central = [];
  let posicao = 0;
  const escrever = async buffer => { await handle.write(buffer, 0, buffer.length, posicao); posicao += buffer.length; };
  try {
    for (const entrada of entradas) {
      const dados = await entrada.ler();
      if (!dados) continue;   // sumiu entre a listagem e a leitura
      const nome = Buffer.from(entrada.nome, 'utf8');
      let metodo = 0, corpo = dados;
      if (!SEM_COMPRESSAO.has(path.extname(entrada.nome).toLowerCase()) && dados.length > 64) {
        const comprimido = await deflateRaw(dados, { level: 6 });
        if (comprimido.length < dados.length) { metodo = 8; corpo = comprimido; }
      }
      const crc = crc32(dados), { hora, data } = horaDos(entrada.mtimeMs);
      if (posicao + 30 + nome.length + corpo.length > 0xffffffff || central.length >= 0xffff) throw GRANDE_DEMAIS();
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(metodo, 8);
      local.writeUInt16LE(hora, 10); local.writeUInt16LE(data, 12); local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(corpo.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
      central.push({ nome, metodo, hora, data, crc, comprimido: corpo.length, tamanho: dados.length, offset: posicao });
      await escrever(local); await escrever(nome); await escrever(corpo);
    }
    const inicioCentral = posicao;
    for (const e of central) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.metodo, 10);
      c.writeUInt16LE(e.hora, 12); c.writeUInt16LE(e.data, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.comprimido, 20); c.writeUInt32LE(e.tamanho, 24);
      c.writeUInt16LE(e.nome.length, 28); c.writeUInt32LE(e.offset, 42);
      await escrever(c); await escrever(e.nome);
    }
    if (posicao > 0xffffffff) throw GRANDE_DEMAIS();
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(central.length, 8); fim.writeUInt16LE(central.length, 10);
    fim.writeUInt32LE(posicao - inicioCentral, 12); fim.writeUInt32LE(inicioCentral, 16);
    await escrever(fim);
    await handle.sync();
    return { arquivos: central.length, bytes: posicao };
  } finally { await handle.close(); }
}

/** Apaga as cópias mais antigas da pasta além de `manter`, e temporários esquecidos. */
async function rotacionar(pasta, manter) {
  let nomes;
  try { nomes = await fs.readdir(pasta); } catch (erro) { if (erro.code === 'ENOENT') return []; throw erro; }
  for (const n of nomes) if (temporario(n)) await fs.rm(path.join(pasta, n), { force: true }).catch(() => {});
  const copias = nomes.filter(n => /^kiro-[\d_-]+\.zip$/.test(n)).sort();
  const apagar = copias.slice(0, Math.max(0, copias.length - manter));
  for (const n of apagar) await comRepeticao(() => fs.rm(path.join(pasta, n), { force: true }));
  return apagar;
}

/**
 * Gera <raiz>/copias/<tipo>/kiro-<data>.zip com o cofre inteiro e aplica o limite `manter`.
 * `exclusivo` (a fila do Vault) segura os salvamentos só enquanto os arquivos pequenos são lidos.
 */
async function gerarCopia(cofre, raiz, tipo, { agora = new Date(), manter = MANTER_MANUAL, exclusivo = f => f() } = {}) {
  if (!(await lerMarca(raiz))) throw new Error(frase('A pasta de backup perdeu a marca .kiro-backup; nada foi alterado.'));
  const pasta = path.join(raiz, 'copias', tipo);
  await fs.mkdir(pasta, { recursive: true });
  const final = path.join(pasta, nomeDaCopia(tipo, agora));
  const lidos = new Map();
  const lista = await exclusivo(async () => {
    const arquivos = await listar(cofre, paraCopia);
    for (const f of arquivos) if (f.size <= LEITURA_COERENTE) {
      try { lidos.set(f.rel, await fs.readFile(f.abs)); } catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
    }
    return arquivos;
  });
  const lerDepois = async f => { try { return await fs.readFile(f.abs); } catch (erro) { if (erro.code === 'ENOENT') return null; throw erro; } };
  const entradas = lista.map(f => ({ nome: f.rel, mtimeMs: f.mtimeMs, ler: async () => { const d = lidos.get(f.rel); lidos.delete(f.rel); return d || (f.size > LEITURA_COERENTE ? lerDepois(f) : null); } }));
  const temporarioZip = `${final}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    const resultado = await gravarZip(temporarioZip, entradas);
    await comRepeticao(() => fs.rename(temporarioZip, final));
    const apagadas = await rotacionar(pasta, manter);
    return { arquivo: final, ...resultado, apagadas };
  } finally { await fs.rm(temporarioZip, { force: true }); }
}

/** Pastas do Google Drive para Desktop encontradas neste computador (ex.: G:\Meu Drive). */
async function detectarGoogleDrive({ plataforma = process.platform, home = require('node:os').homedir() } = {}) {
  const candidatos = [];
  if (plataforma === 'win32') {
    for (const letra of 'DEFGHIJKLMNOPQRSTUVWXYZ') for (const nome of ['Meu Drive', 'My Drive', 'Mi unidad']) candidatos.push(`${letra}:\\${nome}`);
    for (const nome of ['Google Drive', 'Meu Drive', 'My Drive']) candidatos.push(path.join(home, nome));
  } else if (plataforma === 'darwin') {
    try {
      const nuvem = path.join(home, 'Library', 'CloudStorage');
      for (const conta of await fs.readdir(nuvem)) if (conta.startsWith('GoogleDrive')) for (const nome of ['Meu Drive', 'My Drive']) candidatos.push(path.join(nuvem, conta, nome));
    } catch { /* sem Google Drive instalado */ }
  }
  // Letras de rede desconectadas podem demorar: cada checagem tem 1,5 s.
  const existe = c => Promise.race([fs.stat(c).then(i => i.isDirectory(), () => false), new Promise(r => setTimeout(() => r(false), 1500))]);
  const resultados = await Promise.all(candidatos.map(existe));
  return candidatos.filter((_, i) => resultados[i]);
}

/** Lista os arquivos do cofre que entram no espelho (.md e anexos). */
function listarParaEspelho(cofre) {
  return listar(cofre, paraEspelho);
}

/** Gera um Buffer .zip com todos os arquivos do cofre (usado para o envio direto à nuvem). */
async function gerarBufferZipDoCofre(cofre, { exclusivo = f => f() } = {}) {
  const os = require('node:os');
  const temp = path.join(os.tmpdir(), `kiro-nuvem-${randomUUID()}.zip.tmp`);
  const lidos = new Map();
  const lista = await exclusivo(async () => {
    const arquivos = await listar(cofre, paraCopia);
    for (const f of arquivos) if (f.size <= LEITURA_COERENTE) {
      try { lidos.set(f.rel, await fs.readFile(f.abs)); } catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
    }
    return arquivos;
  });
  const lerDepois = async f => { try { return await fs.readFile(f.abs); } catch (erro) { if (erro.code === 'ENOENT') return null; throw erro; } };
  const entradas = lista.map(f => ({ nome: f.rel, mtimeMs: f.mtimeMs, ler: async () => { const d = lidos.get(f.rel); lidos.delete(f.rel); return d || (f.size > LEITURA_COERENTE ? lerDepois(f) : null); } }));
  try {
    await gravarZip(temp, entradas);
    return await fs.readFile(temp);
  } finally { await fs.rm(temp, { force: true }); }
}

module.exports = {
  TIPOS, MARCA, MANTER_MANUAL, configPadrao, normalizarConfig, copiasAtrasadas, nomeDaCopia,
  resolverRaiz, espelhar, gerarCopia, gravarZip, rotacionar, detectarGoogleDrive, crc32,
  listarParaEspelho, gerarBufferZipDoCofre,
};
