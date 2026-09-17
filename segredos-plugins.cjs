// Guarda das chaves (segredos) dos plug-ins, fora do cofre e por computador.
// A cifra vem de fora: no Electron, safeStorage; na web, identidade (sem cifra).
// O valor nunca aparece em mensagem de erro nem em estado().
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const NOME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const LIMITE = 4096;

// Mesmo cofre, mesma chave: resolve, barras normais e, no Windows, sem diferença de caixa.
function cofreNormalizado(cofre) {
  if (typeof cofre !== 'string' || !cofre) throw new Error('Caminho do cofre inválido.');
  let p = path.resolve(cofre).replace(/\\/g, '/');
  if (p.length > 1 && !/^[a-zA-Z]:\/$/.test(p)) p = p.replace(/\/+$/, '');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function prefixo(cofre, pluginId) {
  if (typeof pluginId !== 'string' || !ID.test(pluginId)) throw new Error('Identificador de plug-in inválido.');
  return `${createHash('sha256').update(cofreNormalizado(cofre)).digest('hex')}:${pluginId}:`;
}

function chave(cofre, pluginId, nome) {
  if (typeof nome !== 'string' || !NOME.test(nome)) throw new Error('Nome de segredo inválido.');
  return prefixo(cofre, pluginId) + nome;
}

function criarGuardaDeSegredos({ arquivo, cifrar, decifrar }) {
  // ponytail: fila só dentro deste processo; dois processos no mesmo arquivo ainda podem se atropelar.
  let fila = Promise.resolve();
  const enfileirar = tarefa => {
    const vez = fila.then(tarefa);
    fila = vez.catch(() => {});
    return vez;
  };

  async function ler() {
    try {
      const dados = JSON.parse(await fs.readFile(arquivo, 'utf8'));
      const entradas = dados && typeof dados.entradas === 'object' && !Array.isArray(dados.entradas) ? dados.entradas : {};
      return Object.fromEntries(Object.entries(entradas).filter(([, v]) => typeof v === 'string'));
    } catch { return {}; } // ausente ou corrompido: começa vazio
  }

  async function gravar(entradas) {
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporario, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ version: 1, entradas }, null, 2), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporario, arquivo);
      await fs.chmod(arquivo, 0o600).catch(() => {});
    } finally { await fs.rm(temporario, { force: true }); }
  }

  const abrir = cifrado => {
    try { const v = decifrar(cifrado); return typeof v === 'string' ? v : null; } catch { return null; }
  };

  return {
    definir(cofre, pluginId, nome, valor) {
      return enfileirar(async () => {
        const k = chave(cofre, pluginId, nome);
        if (typeof valor !== 'string') throw new Error('A chave precisa ser texto.');
        if (!valor) throw new Error('A chave não pode ficar vazia.');
        if (valor.length > LIMITE) throw new Error(`A chave passa do tamanho máximo (${LIMITE} caracteres).`);
        let cifrado;
        try { cifrado = cifrar(valor); } catch { throw new Error('Não foi possível cifrar a chave neste computador.'); }
        if (typeof cifrado !== 'string') throw new Error('Não foi possível cifrar a chave neste computador.');
        const entradas = await ler();
        entradas[k] = cifrado;
        await gravar(entradas);
      });
    },
    remover(cofre, pluginId, nome) {
      return enfileirar(async () => {
        const k = chave(cofre, pluginId, nome);
        const entradas = await ler();
        if (!(k in entradas)) return;
        delete entradas[k];
        await gravar(entradas);
      });
    },
    removerDoPlugin(cofre, pluginId) {
      return enfileirar(async () => {
        const p = prefixo(cofre, pluginId);
        const entradas = await ler();
        const sobra = Object.fromEntries(Object.entries(entradas).filter(([k]) => !k.startsWith(p)));
        if (Object.keys(sobra).length !== Object.keys(entradas).length) await gravar(sobra);
      });
    },
    // Só as que este computador consegue decifrar contam como configuradas.
    estado(cofre, pluginId) {
      return enfileirar(async () => {
        const p = prefixo(cofre, pluginId);
        const resultado = {};
        for (const [k, v] of Object.entries(await ler()))
          if (k.startsWith(p) && abrir(v) !== null) resultado[k.slice(p.length)] = true;
        return resultado;
      });
    },
    valor(cofre, pluginId, nome) {
      return enfileirar(async () => {
        const cifrado = (await ler())[chave(cofre, pluginId, nome)];
        return cifrado === undefined ? null : abrir(cifrado);
      });
    },
  };
}

module.exports = { criarGuardaDeSegredos };
