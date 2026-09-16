'use strict';
// Configuração "AI & Integrations" do Kiro, por cofre.
// Mora em <cofre>/.kiro/agent.json — fora do alcance do scan de notas — para que
// a permissão acompanhe o cofre quando ele é copiado para outra máquina.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const PADRAO = Object.freeze({
  enabled: true,
  mcp: { enabled: true },
  // Espelha as caixas previstas na tela de configurações.
  permissions: { read: true, create: true, update: true, delete: false },
  requireConfirmationForDestructive: true,
});

const booleano = (valor, queda) => typeof valor === 'boolean' ? valor : queda;

/**
 * Pasta interna do cofre. Cofres criados como KUROI têm ".kuroi": renomeia na
 * primeira vez, para a configuração e a auditoria continuarem de onde pararam.
 */
function pastaInterna(directory) {
  const atual = path.join(path.resolve(directory), '.kiro'), antiga = path.join(path.resolve(directory), '.kuroi');
  try { if (!fsSync.existsSync(atual) && fsSync.existsSync(antiga)) fsSync.renameSync(antiga, atual); }
  catch { /* sem permissão ou em uso: segue com a pasta nova, sem perder o que havia */ }
  return atual;
}

function normalizar(bruto) {
  const dado = bruto && typeof bruto === 'object' ? bruto : {};
  const permissoes = dado.permissions && typeof dado.permissions === 'object' ? dado.permissions : {};
  return {
    enabled: booleano(dado.enabled, PADRAO.enabled),
    mcp: { enabled: booleano(dado.mcp?.enabled, PADRAO.mcp.enabled) },
    permissions: {
      read: booleano(permissoes.read, PADRAO.permissions.read),
      create: booleano(permissoes.create, PADRAO.permissions.create),
      update: booleano(permissoes.update, PADRAO.permissions.update),
      delete: booleano(permissoes.delete, PADRAO.permissions.delete),
    },
    requireConfirmationForDestructive: booleano(dado.requireConfirmationForDestructive, PADRAO.requireConfirmationForDestructive),
  };
}

class AgentConfig {
  constructor(directory) {
    this.file = path.join(pastaInterna(directory), 'agent.json');
  }

  /** Um arquivo ausente ou corrompido cai no padrão: nunca abre mais permissão do que o previsto. */
  async load() {
    try {
      return normalizar(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (erro) {
      if (erro.code === 'ENOENT') return { ...PADRAO, permissions: { ...PADRAO.permissions }, mcp: { ...PADRAO.mcp } };
      if (erro instanceof SyntaxError) return { ...PADRAO, permissions: { ...PADRAO.permissions }, mcp: { ...PADRAO.mcp } };
      throw erro;
    }
  }

  async save(parcial) {
    const atual = await this.load();
    const completo = normalizar({ ...atual, ...parcial, permissions: { ...atual.permissions, ...(parcial?.permissions || {}) } });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(completo, null, 2)}\n`, 'utf8');
    return completo;
  }
}

module.exports = { pastaInterna, AgentConfig, DEFAULT_CONFIG: PADRAO };
