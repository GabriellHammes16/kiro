'use strict';
/**
 * Montagem da pilha de agentes do Kuroi.
 *
 *   cliente (MCP, CLI, biblioteca)
 *        -> AgentToolkit   schema + permissão + auditoria
 *        -> KuroiAgentApi  operações do cofre
 *        -> Vault          Markdown no disco
 */
const os = require('node:os');
const path = require('node:path');
const fsSync = require('node:fs');
const { Vault } = require('../vault.cjs');
const { KuroiAgentApi } = require('./api.cjs');
const { AgentToolkit } = require('./tools.cjs');
const { AuditLog } = require('./audit.cjs');
const { AgentConfig } = require('./config.cjs');
const { KuroiEvents } = require('./events.cjs');
const { AgentError } = require('./security.cjs');

/** Onde o aplicativo desktop guarda a escolha de cofre, por plataforma. */
function arquivoDeConfiguracaoDesktop() {
  const casa = os.homedir();
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(casa, 'AppData', 'Roaming');
    return path.join(base, 'KUROI', 'vault-settings.json');
  }
  if (process.platform === 'darwin') return path.join(casa, 'Library', 'Application Support', 'KUROI', 'vault-settings.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(casa, '.config'), 'KUROI', 'vault-settings.json');
}

/**
 * Resolve o cofre na mesma ordem que o usuário espera:
 * argumento explícito, variável de ambiente, cofre escolhido no desktop,
 * cofre padrão do desktop e, por fim, o cofre de exemplo do projeto.
 */
function resolveVaultDirectory(explicito) {
  if (explicito) return path.resolve(explicito);
  if (process.env.KUROI_VAULT) return path.resolve(process.env.KUROI_VAULT);
  try {
    const salvo = JSON.parse(fsSync.readFileSync(arquivoDeConfiguracaoDesktop(), 'utf8'));
    if (salvo && typeof salvo.directory === 'string' && salvo.directory.trim()) return path.resolve(salvo.directory);
  } catch { /* sem configuração do desktop: segue para os padrões */ }
  const padraoDesktop = path.join(os.homedir(), 'Documents', 'KUROI', 'vault');
  if (fsSync.existsSync(padraoDesktop)) return padraoDesktop;
  return path.resolve(__dirname, '..', 'vault');
}

/** Monta a pilha completa para um cofre. */
function createKuroiAgent({ vaultDirectory, events } = {}) {
  const directory = resolveVaultDirectory(vaultDirectory);
  const barramento = events || new KuroiEvents();
  const vault = new Vault(directory);
  const api = new KuroiAgentApi(vault, { events: barramento });
  const audit = new AuditLog(directory);
  const config = new AgentConfig(directory);
  const toolkit = new AgentToolkit({ api, audit, config });
  return { directory, vault, api, audit, config, events: barramento, toolkit };
}

module.exports = { createKuroiAgent, resolveVaultDirectory, KuroiAgentApi, AgentToolkit, AuditLog, AgentConfig, KuroiEvents, AgentError };
