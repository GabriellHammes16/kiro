'use strict';
// Barramento de eventos interno. O Kiro não tinha um; este é o menor útil.
// Serve para, no futuro, ligar índice, embeddings, automações ou atualização da UI
// sem que a Agent API precise conhecer nenhum desses consumidores.
const { EventEmitter } = require('node:events');

const NOMES = ['note.created', 'note.updated', 'note.deleted', 'note.moved', 'note.restored', 'folder.created', 'fluxo.created', 'fluxo.updated'];

class KiroEvents extends EventEmitter {
  emitVaultEvent(nome, carga) {
    if (!NOMES.includes(nome)) throw new Error(`Evento desconhecido: ${nome}`);
    // Um ouvinte com defeito não pode derrubar uma gravação já concluída.
    try { this.emit(nome, { ...carga, event: nome, at: new Date().toISOString() }); }
    catch { /* ignorado de propósito */ }
    return nome;
  }
}

module.exports = { KiroEvents, EVENT_NAMES: NOMES };
