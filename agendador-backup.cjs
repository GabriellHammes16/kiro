// Agendador de backup automático, compartilhado entre o app desktop e o servidor web.
// Guarda as configurações, tokens OAuth cifrados e histórico de execuções em backup.json,
// fora do cofre e por computador (indexado pelo caminho do cofre).
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const backup = require('./backup.cjs');
const googleDrive = require('./google-drive.cjs');
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
  pastaNuvemId: '',
});

function normalizarEstado(entrada = {}) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
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
    pastaNuvemId: typeof e.pastaNuvemId === 'string' ? e.pastaNuvemId.slice(0, 128) : '',
  };
}

function normalizarSegredos(entrada = {}) {
  const s = entrada && typeof entrada === 'object' ? entrada : {};
  return {
    clientSecret: typeof s.clientSecret === 'string' ? s.clientSecret : '',
    refreshToken: typeof s.refreshToken === 'string' ? s.refreshToken : '',
  };
}

/**
 * Cria o agendador de backup (modo pasta local e modo nuvem Google Drive).
 */
function criarAgendadorDeBackup({
  arquivo,
  obterCofre,
  cifrar = v => v,
  decifrar = v => v,
  abrirUrl = null,
  requisitarDrive = undefined,
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
  let fluxoOAuthAtivo = null;

  const abrirSegredo = textoCifrado => {
    if (!textoCifrado || typeof textoCifrado !== 'string') return '';
    try { const v = decifrar(textoCifrado); return typeof v === 'string' ? v : ''; } catch { return ''; }
  };

  const guardarSegredo = texto => {
    if (!texto || typeof texto !== 'string') return '';
    return cifrar(texto);
  };

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
        segredos: normalizarSegredos(reg.segredos),
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
        segredos: normalizarSegredos(atual.segredos),
      });
      cofres[k] = {
        cofre: cofreDir,
        config: backup.normalizarConfig(proximo.config),
        estado: normalizarEstado(proximo.estado),
        segredos: normalizarSegredos(proximo.segredos),
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
    const { config, estado, segredos } = await lerRegistro(cofreDir);
    if (!forcarEspelho && !forcarCopia && !config.ligado) return null;

    const emNuvem = config.modo === 'nuvem';
    const refreshToken = abrirSegredo(segredos.refreshToken);
    const clientSecret = abrirSegredo(segredos.clientSecret);

    if (emNuvem) {
      if (!config.nuvem.clientId || !refreshToken) {
        if (exigirDestino) throw new Error(frase('Conecte sua conta do Google Drive antes de fazer o backup na nuvem.'));
        return null;
      }
    } else if (!config.destino) {
      if (exigirDestino) throw new Error(frase('Escolha a pasta de destino do backup.'));
      return null;
    }

    const agora = relogio();
    const agoraMs = agora.getTime();
    try {
      let fezEspelho = false;
      let pastaCofreNuvem = '';
      const copiasFeitas = [];
      const deveEspelhar = config.espelho && (forcarEspelho || (config.ligado && (espelhoPendente || !estado.ultimoEspelho)));
      const exclusivo = typeof v.exclusive === 'function' ? op => v.exclusive(op) : op => op();
      const atrasadas = config.ligado ? backup.copiasAtrasadas(config, estado.ultimasCopias, agora) : [];

      if (emNuvem) {
        if (deveEspelhar || forcarCopia || atrasadas.length || (!config.espelho && estado.ultimoEspelho > 0)) {
          const accessToken = await googleDrive.obterAccessToken({
            clientId: config.nuvem.clientId,
            clientSecret,
            refreshToken,
          }, requisitarDrive);
          const cliente = googleDrive.criarClienteDrive(accessToken, requisitarDrive);
          const pastaCofreId = await googleDrive.garantirRaizNaNuvem(cliente, cofreDir);
          pastaCofreNuvem = pastaCofreId;

          if (deveEspelhar) {
            espelhoPendente = false;
            const arquivos = await backup.listarParaEspelho(cofreDir);
            await googleDrive.espelharNaNuvem(cliente, pastaCofreId, arquivos);
            fezEspelho = true;
          } else if (!config.espelho) {
            await googleDrive.limparEspelhoNaNuvem(cliente, pastaCofreId);
          }

          if (forcarCopia || atrasadas.length) {
            const bufferZip = await backup.gerarBufferZipDoCofre(cofreDir, { exclusivo });
            if (forcarCopia) {
              const nome = backup.nomeDaCopia('manual', agora);
              await googleDrive.enviarCopiaParaNuvem(cliente, pastaCofreId, 'manual', nome, bufferZip, backup.MANTER_MANUAL);
              copiasFeitas.push('manual');
            }
            for (const tipo of atrasadas) {
              const nome = backup.nomeDaCopia(tipo, agora);
              await googleDrive.enviarCopiaParaNuvem(cliente, pastaCofreId, tipo, nome, bufferZip, config.copias[tipo].manter);
              copiasFeitas.push(tipo);
            }
          }
        }
      } else {
        const raiz = await backup.resolverRaiz(cofreDir, config.destino);
        if (deveEspelhar) {
          espelhoPendente = false;
          await backup.espelhar(cofreDir, raiz);
          fezEspelho = true;
        }
        if (forcarCopia) {
          await backup.gerarCopia(cofreDir, raiz, 'manual', { agora, manter: backup.MANTER_MANUAL, exclusivo });
          copiasFeitas.push('manual');
        }
        for (const tipo of atrasadas) {
          await backup.gerarCopia(cofreDir, raiz, tipo, { agora, manter: config.copias[tipo].manter, exclusivo });
          copiasFeitas.push(tipo);
        }
      }

      if (fezEspelho || copiasFeitas.length || estado.ultimoErro || pastaCofreNuvem || (!config.espelho && estado.ultimoEspelho > 0)) {
        await atualizarRegistro(cofreDir, reg => {
          if (fezEspelho) reg.estado.ultimoEspelho = agoraMs;
          else if (!config.espelho) reg.estado.ultimoEspelho = 0;
          if (pastaCofreNuvem) reg.estado.pastaNuvemId = pastaCofreNuvem;
          for (const t of copiasFeitas) reg.estado.ultimasCopias[t] = agoraMs;
          reg.estado.ultimoErro = '';
          reg.estado.ultimoErroEm = 0;
          return reg;
        });
      }
      return { fezEspelho, copiasFeitas };
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
    if (fluxoOAuthAtivo) { fluxoOAuthAtivo.cancelar(); fluxoOAuthAtivo = null; }
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

  const temDestinoConfigurado = (config, segredos) =>
    config.modo === 'nuvem'
      ? Boolean(config.nuvem.clientId && abrirSegredo(segredos.refreshToken))
      : Boolean(config.destino);

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
      const [{ config, estado, segredos }, drives] = await Promise.all([
        lerRegistro(v.directory),
        backup.detectarGoogleDrive(),
      ]);
      return {
        config,
        estado,
        rodando,
        drives,
        nuvemConectada: Boolean(config.nuvem.clientId && abrirSegredo(segredos.refreshToken)),
        temClientSecret: Boolean(abrirSegredo(segredos.clientSecret)),
      };
    },
    async salvarConfig(parcial = {}) {
      const v = cofreAtual();
      const salvo = await atualizarRegistro(v.directory, reg => {
        const p = parcial && typeof parcial === 'object' ? parcial : {};
        const mesclado = {
          ...reg.config,
          ...p,
          nuvem: {
            ...reg.config.nuvem,
            ...(p.nuvem && typeof p.nuvem === 'object' ? p.nuvem : {}),
          },
          copias: {
            ...reg.config.copias,
            ...(p.copias && typeof p.copias === 'object' ? p.copias : {}),
          },
        };
        if (typeof p.clientSecret === 'string' && p.clientSecret.trim()) {
          reg.segredos.clientSecret = guardarSegredo(p.clientSecret.trim());
        }
        return { config: backup.normalizarConfig(mesclado), estado: reg.estado, segredos: reg.segredos };
      });
      if ((salvo.config.ligado || (!salvo.config.espelho && salvo.estado.ultimoEspelho > 0)) && temDestinoConfigurado(salvo.config, salvo.segredos)) {
        executarEmFila(() => rodarCiclo());
      }
      return this.obterStatus();
    },
    async conectarGoogleDrive({ clientId = '', clientSecret = '', aguardar = true } = {}) {
      const v = cofreAtual();
      const regAtual = await lerRegistro(v.directory);
      const idFinal = (typeof clientId === 'string' && clientId.trim()) || regAtual.config.nuvem.clientId;
      const secretFinal = (typeof clientSecret === 'string' && clientSecret.trim()) || abrirSegredo(regAtual.segredos.clientSecret);
      if (!idFinal) throw new Error(frase('Informe o Client ID do Google Cloud para conectar.'));

      await atualizarRegistro(v.directory, reg => {
        reg.config.modo = 'nuvem';
        reg.config.nuvem.clientId = idFinal;
        if (typeof clientSecret === 'string' && clientSecret.trim()) {
          reg.segredos.clientSecret = guardarSegredo(clientSecret.trim());
        }
        return reg;
      });

      if (fluxoOAuthAtivo) fluxoOAuthAtivo.cancelar();
      const fluxo = await googleDrive.iniciarFluxoOAuth({
        clientId: idFinal,
        clientSecret: secretFinal,
        requisitar: requisitarDrive,
      });
      fluxoOAuthAtivo = fluxo;

      const concluir = fluxo.aguardarConclusao().then(async resultado => {
        if (fluxoOAuthAtivo === fluxo) fluxoOAuthAtivo = null;
        const salvo = await atualizarRegistro(v.directory, reg => {
          reg.config.modo = 'nuvem';
          reg.config.nuvem.clientId = idFinal;
          reg.config.nuvem.email = resultado.email || '';
          if (resultado.refreshToken) reg.segredos.refreshToken = guardarSegredo(resultado.refreshToken);
          reg.estado.ultimoErro = '';
          reg.estado.ultimoErroEm = 0;
          return reg;
        });
        if (salvo.config.ligado) executarEmFila(() => rodarCiclo());
        return this.obterStatus();
      });

      if (typeof abrirUrl === 'function') await abrirUrl(fluxo.urlAutorizacao);
      if (!aguardar) {
        concluir.catch(() => {});
        return { urlAutorizacao: fluxo.urlAutorizacao };
      }
      return concluir;
    },
    async desconectarGoogleDrive() {
      const v = cofreAtual();
      await atualizarRegistro(v.directory, reg => {
        reg.config.nuvem.email = '';
        reg.segredos.refreshToken = '';
        return reg;
      });
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
    async urlPastaNaNuvem() {
      const v = cofreAtual();
      const { config, estado, segredos } = await lerRegistro(v.directory);
      if (estado.pastaNuvemId) return `https://drive.google.com/drive/folders/${encodeURIComponent(estado.pastaNuvemId)}`;
      const refreshToken = abrirSegredo(segredos.refreshToken);
      const clientSecret = abrirSegredo(segredos.clientSecret);
      if (!config.nuvem.clientId || !refreshToken) throw new Error(frase('Conecte sua conta do Google Drive antes de fazer o backup na nuvem.'));
      const accessToken = await googleDrive.obterAccessToken({ clientId: config.nuvem.clientId, clientSecret, refreshToken }, requisitarDrive);
      const cliente = googleDrive.criarClienteDrive(accessToken, requisitarDrive);
      const pastaCofreId = await googleDrive.garantirRaizNaNuvem(cliente, v.directory);
      await atualizarRegistro(v.directory, reg => { reg.estado.pastaNuvemId = pastaCofreId; return reg; });
      return `https://drive.google.com/drive/folders/${encodeURIComponent(pastaCofreId)}`;
    },
    aguardarFila: () => filaExecucao,
  };
}

module.exports = { criarAgendadorDeBackup, chaveDoCofre };
