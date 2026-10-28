// Agendador de backup automático, compartilhado entre o app desktop e o servidor web.
// Guarda as configurações e o histórico de execuções em backup.json, fora do cofre e por
// computador (indexado pelo caminho do cofre), pois cada máquina tem seu caminho do Drive.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const backup = require('./backup.cjs');
// Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
const frase = f => f;

const ATRASO_ESPELHO_MS = 30 * 1000;
const INTERVALO_CHECAGEM_MS = 10 * 60 * 1000;
const ATRASO_INICIAL_MS = 5 * 1000;

function chaveDoCofre(cofre) {
  if (typeof cofre !== 'string' || !cofre) throw new Error(frase('Caminho do cofre inválido.'));
  let p = path.resolve(cofre).replace(/\\/g, '/');
  if (p.length > 1 && !/^[a-zA-Z]:\/$/.test(p)) p = p.replace(/\/+$/, '');
  if (process.platform === 'win32') p = p.toLowerCase();
  return createHash('sha256').update(p).digest('hex');
}

const estadoPadrao = () => ({
  ultimoEspelho: 0,
  ultimasCopias: { horas: 0, diaria: 0, semanal: 0, mensal: 0, manual: 0 },
  ultimoErro: '',
  ultimoErroEm: 0,
});

function normalizarEstado(entrada = {}) {
  const base = estadoPadrao(), e = entrada && typeof entrada === 'object' ? entrada : {};
  const u = e.ultimasCopias && typeof e.ultimasCopias === 'object' ? e.ultimasCopias : {};
  const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  return {
    ultimoEspelho: num(e.ultimoEspelho),
    ultimasCopias: {
      horas: num(u.horas),
      diaria: num(u.diaria),
      semanal: num(u.semanal),
      mensal: num(u.mensal),
      manual: num(u.manual),
    },
    ultimoErro: typeof e.ultimoErro === 'string' ? e.ultimoErro.slice(0, 500) : '',
    ultimoErroEm: num(e.ultimoErroEm),
  };
}

/**
 * Cria o agendador de backup.
 * `obterCofre`: () => Vault | null
 * `arquivo`: caminho completo de backup.json (fora do cofre)
 */
function criarAgendadorDeBackup({
  arquivo,
  obterCofre,
  atrasoEspelhoMs = ATRASO_ESPELHO_MS,
  intervaloChecagemMs = INTERVALO_CHECAGEM_MS,
  atrasoInicialMs = ATRASO_INICIAL_MS,
  relogio = () => new Date(),
}) {
  let filaArquivo = Promise.resolve();
  let filaExecucao = Promise.resolve();
  let rodando = false;
  let timerEspelho = null;
  let timerChecagem = null;
  let timerInicial = null;
  let espelhoPendente = false;

  const enfileirarArquivo = fn => {
    const p = filaArquivo.then(fn);
    filaArquivo = p.catch(() => {});
    return p;
  };

  async function lerTudo() {
    try {
      const bruto = JSON.parse(await fs.readFile(arquivo, 'utf8'));
      return bruto && typeof bruto.cofres === 'object' && !Array.isArray(bruto.cofres) ? bruto.cofres : {};
    } catch { return {}; }
  }

  async function gravarTudo(cofres) {
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    const temp = `${arquivo}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ version: 1, cofres }, null, 2), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temp, arquivo);
    } finally { await fs.rm(temp, { force: true }); }
  }

  function lerRegistro(cofreDir) {
    return enfileirarArquivo(async () => {
      const k = chaveDoCofre(cofreDir);
      const cofres = await lerTudo();
      const reg = cofres[k] || {};
      return {
        config: backup.normalizarConfig(reg.config),
        estado: normalizarEstado(reg.estado),
      };
    });
  }

  function atualizarRegistro(cofreDir, modificador) {
    return enfileirarArquivo(async () => {
      const k = chaveDoCofre(cofreDir);
      const cofres = await lerTudo();
      const atual = cofres[k] || {};
      const proximo = await modificador({
        config: backup.normalizarConfig(atual.config),
        estado: normalizarEstado(atual.estado),
      });
      cofres[k] = {
        cofre: cofreDir,
        config: backup.normalizarConfig(proximo.config),
        estado: normalizarEstado(proximo.estado),
      };
      await gravarTudo(cofres);
      return cofres[k];
    });
  }

  const cofreAtual = () => {
    const v = typeof obterCofre === 'function' ? obterCofre() : null;
    if (!v || !v.directory) throw new Error(frase('Escolha onde ficam suas notas para começar.'));
    return v;
  };

  function executarEmFila(tarefa) {
    const vez = filaExecucao.then(async () => {
      rodando = true;
      try { return await tarefa(); }
      finally { rodando = false; }
    });
    filaExecucao = vez.catch(() => {});
    return vez;
  }

  async function rodarCiclo({ forcarEspelho = false, forcarCopia = false, exigirDestino = false } = {}) {
    let v;
    try { v = cofreAtual(); } catch (e) { if (exigirDestino) throw e; return null; }
    const cofreDir = v.directory;
    const { config, estado } = await lerRegistro(cofreDir);
    if (!forcarEspelho && !forcarCopia && !config.ligado) return null;
    if (!config.destino) {
      if (exigirDestino) throw new Error(frase('Escolha a pasta de destino do backup.'));
      return null;
    }

    const agora = relogio();
    const agoraMs = agora.getTime();
    try {
      const raiz = await backup.resolverRaiz(cofreDir, config.destino);
      let fezEspelho = false;
      const copiasFeitas = [];

      const deveEspelhar = forcarEspelho || (config.ligado && config.espelho && (espelhoPendente || !estado.ultimoEspelho));
      if (deveEspelhar) {
        espelhoPendente = false;
        await backup.espelhar(cofreDir, raiz);
        fezEspelho = true;
      }

      const exclusivo = typeof v.exclusive === 'function' ? op => v.exclusive(op) : op => op();
      if (forcarCopia) {
        await backup.gerarCopia(cofreDir, raiz, 'manual', { agora, manter: backup.MANTER_MANUAL, exclusivo });
        copiasFeitas.push('manual');
      }
      if (config.ligado) {
        const atrasadas = backup.copiasAtrasadas(config, estado.ultimasCopias, agora);
        for (const tipo of atrasadas) {
          await backup.gerarCopia(cofreDir, raiz, tipo, { agora, manter: config.copias[tipo].manter, exclusivo });
          copiasFeitas.push(tipo);
        }
      }

      if (fezEspelho || copiasFeitas.length || estado.ultimoErro) {
        await atualizarRegistro(cofreDir, reg => {
          if (fezEspelho) reg.estado.ultimoEspelho = agoraMs;
          for (const t of copiasFeitas) reg.estado.ultimasCopias[t] = agoraMs;
          reg.estado.ultimoErro = '';
          reg.estado.ultimoErroEm = 0;
          return reg;
        });
      }
      return { raiz, fezEspelho, copiasFeitas };
    } catch (erro) {
      const msg = erro?.message || String(erro);
      await atualizarRegistro(cofreDir, reg => {
        reg.estado.ultimoErro = msg;
        reg.estado.ultimoErroEm = agoraMs;
        return reg;
      }).catch(() => {});
      if (exigirDestino) throw erro;
      return null;
    }
  }

  function limparTimers() {
    if (timerEspelho) { clearTimeout(timerEspelho); timerEspelho = null; }
    if (timerChecagem) { clearInterval(timerChecagem); timerChecagem = null; }
    if (timerInicial) { clearTimeout(timerInicial); timerInicial = null; }
  }

  function iniciar() {
    limparTimers();
    if (atrasoInicialMs > 0) {
      timerInicial = setTimeout(() => {
        timerInicial = null;
        executarEmFila(() => rodarCiclo());
      }, atrasoInicialMs);
      if (typeof timerInicial.unref === 'function') timerInicial.unref();
    }
    if (intervaloChecagemMs > 0) {
      timerChecagem = setInterval(() => {
        executarEmFila(() => rodarCiclo());
      }, intervaloChecagemMs);
      if (typeof timerChecagem.unref === 'function') timerChecagem.unref();
    }
  }

  return {
    iniciar,
    parar: limparTimers,
    aoSalvar() {
      espelhoPendente = true;
      if (timerEspelho) clearTimeout(timerEspelho);
      timerEspelho = setTimeout(() => {
        timerEspelho = null;
        executarEmFila(() => rodarCiclo());
      }, atrasoEspelhoMs);
      if (typeof timerEspelho.unref === 'function') timerEspelho.unref();
    },
    async obterStatus() {
      const v = cofreAtual();
      const [{ config, estado }, drives] = await Promise.all([
        lerRegistro(v.directory),
        backup.detectarGoogleDrive(),
      ]);
      return { config, estado, rodando, drives };
    },
    async salvarConfig(parcial = {}) {
      const v = cofreAtual();
      const salvo = await atualizarRegistro(v.directory, reg => {
        const mesclado = {
          ...reg.config,
          ...(parcial && typeof parcial === 'object' ? parcial : {}),
          copias: {
            ...reg.config.copias,
            ...(parcial && typeof parcial.copias === 'object' ? parcial.copias : {}),
          },
        };
        const novaConfig = backup.normalizarConfig(mesclado);
        return { config: novaConfig, estado: reg.estado };
      });
      if (salvo.config.ligado && salvo.config.destino) {
        executarEmFila(() => rodarCiclo());
      }
      return this.obterStatus();
    },
    async executarAgora({ espelho = true, copia = true } = {}) {
      await executarEmFila(() => rodarCiclo({ forcarEspelho: espelho !== false, forcarCopia: copia !== false, exigirDestino: true }));
      return this.obterStatus();
    },
    async pastaDoCofreNoDestino() {
      const v = cofreAtual();
      const { config } = await lerRegistro(v.directory);
      return backup.resolverRaiz(v.directory, config.destino);
    },
    // Usado pelos testes para esperar a fila terminar.
    aguardarFila: () => filaExecucao,
  };
}

module.exports = { criarAgendadorDeBackup, chaveDoCofre };
