'use strict';
/**
 * Montagem da pilha de agentes do Kiro.
 *
 *   cliente (MCP, CLI, biblioteca)
 *        -> AgentToolkit   schema + permissão + auditoria
 *        -> KiroAgentApi  operações do cofre
 *        -> Vault          Markdown no disco
 */
const os = require('node:os');
const path = require('node:path');
const fsSync = require('node:fs');
const { Vault } = require('../vault.cjs');
const { KiroAgentApi } = require('./api.cjs');
const { AgentToolkit } = require('./tools.cjs');
const { AuditLog } = require('./audit.cjs');
const { AgentConfig } = require('./config.cjs');
const { KiroEvents } = require('./events.cjs');
const { AgentError } = require('./security.cjs');

/** Onde o aplicativo desktop guarda a escolha de cofre, por plataforma. */
function arquivoDeConfiguracaoDesktop() {
  const casa = os.homedir();
  const pasta = nome => {
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(casa, 'AppData', 'Roaming'), nome, 'vault-settings.json');
    if (process.platform === 'darwin') return path.join(casa, 'Library', 'Application Support', nome, 'vault-settings.json');
    return path.join(process.env.XDG_CONFIG_HOME || path.join(casa, '.config'), nome, 'vault-settings.json');
  };
  // Quem instalou o aplicativo como KUROI tem a escolha de cofre guardada com o nome antigo.
  const atual = pasta('Kiro');
  return fsSync.existsSync(atual) ? atual : (fsSync.existsSync(pasta('KUROI')) ? pasta('KUROI') : atual);
}

/**
 * Resolve o cofre na mesma ordem que o usuário espera:
 * argumento explícito, variável de ambiente, cofre escolhido no desktop,
 * cofre padrão do desktop e, por fim, o cofre de exemplo do projeto.
 */
function resolveVaultDirectory(explicito) {
  if (explicito) return path.resolve(explicito);
  const doAmbiente = process.env.KIRO_VAULT || process.env.KUROI_VAULT;
  if (doAmbiente) return path.resolve(doAmbiente);
  try {
    const salvo = JSON.parse(fsSync.readFileSync(arquivoDeConfiguracaoDesktop(), 'utf8'));
    if (salvo && typeof salvo.directory === 'string' && salvo.directory.trim()) return path.resolve(salvo.directory);
  } catch { /* sem configuração do desktop: segue para os padrões */ }
  // Instalação nova usa Documents/Kiro; quem veio do KUROI continua no cofre de sempre.
  for (const nome of ['Kiro', 'KUROI']) {
    const padraoDesktop = path.join(os.homedir(), 'Documents', nome, 'vault');
    if (fsSync.existsSync(padraoDesktop)) return padraoDesktop;
  }
  return path.resolve(__dirname, '..', 'vault');
}

/** Monta a pilha completa para um cofre. */
function createKiroAgent({ vaultDirectory, events } = {}) {
  const directory = resolveVaultDirectory(vaultDirectory);
  const barramento = events || new KiroEvents();
  const vault = new Vault(directory);
  const api = new KiroAgentApi(vault, { events: barramento });
  const audit = new AuditLog(directory);
  const config = new AgentConfig(directory);
  const toolkit = new AgentToolkit({ api, audit, config });
  return { directory, vault, api, audit, config, events: barramento, toolkit };
}

module.exports = { createKiroAgent, resolveVaultDirectory, KiroAgentApi, AgentToolkit, AuditLog, AgentConfig, KiroEvents, AgentError };
