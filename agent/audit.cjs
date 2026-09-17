'use strict';
// Registro de auditoria em JSONL, um evento por linha.
// Fica em <cofre>/.kiro/audit.log: o scan() do Vault ignora entradas ocultas na
// raiz, então este arquivo nunca vira nota nem entra na lista de remoções.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pastaInterna } = require('./config.cjs');

const LIMITE_BYTES = 5 * 1024 * 1024;

class AuditLog {
  constructor(directory) {
    this.directory = pastaInterna(directory);
    this.file = path.join(this.directory, 'audit.log');
    this.fila = Promise.resolve();
  }

  /**
   * Grava uma entrada. Nunca recebe conteúdo de nota, token ou segredo:
   * só identificadores, caminhos, contagens e o resultado da operação.
   */
  record(entrada) {
    const linha = {
      timestamp: new Date().toISOString(),
      client: entrada.client || 'unknown',
      clientName: entrada.clientName || undefined,
      action: entrada.action,
      risk: entrada.risk,
      target: entrada.target ?? null,
      status: entrada.status,
      errorCode: entrada.errorCode || undefined,
      error: entrada.error || undefined,
      // Rede dos plug-ins: só método, status HTTP, tamanho e duração.
      method: entrada.method || undefined,
      httpStatus: entrada.httpStatus ?? undefined,
      bytes: entrada.bytes ?? undefined,
      durationMs: entrada.durationMs ?? undefined,
      // Ganchos para um Undo futuro: o Vault já guarda um snapshot por gravação.
      revisionBefore: entrada.revisionBefore || undefined,
      revisionAfter: entrada.revisionAfter || undefined,
    };
    this.fila = this.fila.then(() => this.#gravar(linha)).catch(() => {});
    return this.fila.then(() => linha);
  }

  async #gravar(linha) {
    await fs.mkdir(this.directory, { recursive: true });
    await this.#rotacionar();
    await fs.appendFile(this.file, `${JSON.stringify(linha)}\n`, 'utf8');
  }

  async #rotacionar() {
    try {
      const info = await fs.stat(this.file);
      if (info.size > LIMITE_BYTES) await fs.rename(this.file, `${this.file}.1`);
    } catch (erro) {
      if (erro.code !== 'ENOENT') throw erro;
    }
  }

  /** Lê as últimas entradas, da mais recente para a mais antiga. */
  async read({ limit = 50 } = {}) {
    let bruto;
    try { bruto = await fs.readFile(this.file, 'utf8'); }
    catch (erro) { if (erro.code === 'ENOENT') return []; throw erro; }
    const linhas = bruto.split('\n').filter(Boolean).slice(-limit);
    return linhas.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  }
}

module.exports = { AuditLog };
