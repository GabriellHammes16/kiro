'use strict';
// Validação de tudo que chega de um agente. Nada aqui confia na entrada.
const { validFolderName, pathKey } = require('../domain.js');

class AgentError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    if (details) this.details = details;
  }
}

// Diretórios de trabalho do cofre. O agente nunca os enxerga nem os altera.
const RESERVED = new Set(['.history', '.trash', '.staging', '.kiro', 'caderno.json', '.transaction.json', '.kiro.lock',
  // Nomes de quando o aplicativo se chamava KUROI: seguem fora do alcance dos agentes.
  '.kuroi', '.kuroi.lock']);
const MAX_SEGMENTS = 15;
const MAX_TITLE = 200;
// 1 milhão de caracteres dá umas 500 páginas. Cada gravação copia o cofre para .history,
// então notas gigantes pesam várias vezes no disco.
const MAX_NOTE_CONTENT = 1_000_000;

// Nome curto do Windows (KIRO~1, HISTOR~1, CADERN~1.JSO): abre a pasta real com outro nome
// e passaria pela checagem de nomes ocultos. Até 8 caracteres antes da extensão, como no 8.3.
function pareceNomeCurto(parte) {
  const nome = parte.replace(/[. ]+$/, '');
  return /^[^.]+~\d+(\.[^.]{0,3})?$/.test(nome) && nome.split('.')[0].length <= 8;
}

function texto(valor, campo) {
  if (typeof valor !== 'string') throw new AgentError('INVALID_INPUT', `O campo "${campo}" deve ser um texto.`);
  return valor;
}

/**
 * Converte um caminho vindo do agente em um caminho relativo ao cofre, ou falha.
 * Recusa caminho absoluto, unidade de disco, "..", barra invertida e nomes ocultos.
 */
function vaultRelativePath(entrada, { campo = 'path', extensao = null } = {}) {
  const bruto = texto(entrada, campo).trim();
  if (!bruto) throw new AgentError('INVALID_PATH', `O campo "${campo}" não pode ser vazio.`);
  if (bruto.includes('\0')) throw new AgentError('INVALID_PATH', 'Caminho com caractere nulo.');
  if (bruto.includes('\\')) throw new AgentError('INVALID_PATH', 'Use "/" para separar pastas.');
  if (bruto.includes(':')) throw new AgentError('INVALID_PATH', 'Caminho com unidade de disco não é aceito; use um caminho relativo ao cofre.');
  if (bruto.startsWith('/') || bruto.startsWith('~')) throw new AgentError('INVALID_PATH', 'O caminho deve ser relativo ao cofre.');

  const partes = bruto.split('/');
  if (partes.length > MAX_SEGMENTS) throw new AgentError('INVALID_PATH', `Caminho com mais de ${MAX_SEGMENTS} níveis.`);
  for (const parte of partes) {
    if (!parte) throw new AgentError('INVALID_PATH', 'O caminho tem uma barra sobrando.');
    if (parte === '.' || parte === '..') throw new AgentError('PATH_TRAVERSAL', 'Navegar para fora do cofre não é permitido.');
    if (parte.startsWith('.')) throw new AgentError('RESERVED_PATH', 'Arquivos e pastas ocultos não fazem parte do cofre.');
    if (pareceNomeCurto(parte)) throw new AgentError('RESERVED_PATH', `"${parte}" parece um nome curto do Windows, que pode apontar para uma área interna. Use outro nome.`);
  }
  if (RESERVED.has(partes[0])) throw new AgentError('RESERVED_PATH', `"${partes[0]}" é uma área interna do Kiro.`);
  if (extensao && !new RegExp(`\\.${extensao}$`, 'i').test(bruto)) {
    throw new AgentError('INVALID_PATH', `O caminho deve terminar em .${extensao}`);
  }
  return partes.join('/');
}

/** Valida um caminho de pasta ("Projetos/Ideias") e devolve seus segmentos. */
function folderSegments(entrada, { campo = 'folder' } = {}) {
  const bruto = typeof entrada === 'string' ? entrada.trim() : '';
  if (!bruto) return [];
  const relativo = vaultRelativePath(bruto, { campo });
  const partes = relativo.split('/');
  for (const parte of partes) {
    if (!validFolderName(parte)) {
      throw new AgentError('INVALID_NAME', `"${parte}" não é um nome de pasta válido. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.`);
    }
  }
  return partes;
}

function noteTitle(entrada, { campo = 'title' } = {}) {
  const valor = texto(entrada, campo).trim();
  if (!valor) throw new AgentError('INVALID_NAME', 'A nota precisa de um título.');
  if (valor.length > MAX_TITLE) throw new AgentError('INVALID_NAME', `O título passa de ${MAX_TITLE} caracteres.`);
  if (/[\u0000-\u001f\u007f]/.test(valor)) throw new AgentError('INVALID_NAME', 'O título tem caracteres de controle.');
  return valor;
}

function tagList(entrada, { campo = 'tags' } = {}) {
  if (entrada === undefined || entrada === null) return undefined;
  if (!Array.isArray(entrada)) throw new AgentError('INVALID_INPUT', `O campo "${campo}" deve ser uma lista.`);
  const limpas = entrada.map(t => texto(t, campo).trim().replace(/^#/, '')).filter(Boolean);
  for (const tag of limpas) {
    if (!/^[\p{L}\p{N}_/-]+$/u.test(tag)) throw new AgentError('INVALID_NAME', `"${tag}" não é uma tag válida.`);
  }
  return [...new Set(limpas)];
}

const mesmoCaminho = (a, b) => pathKey(String(a || '')) === pathKey(String(b || ''));

module.exports = { AgentError, vaultRelativePath, folderSegments, noteTitle, tagList, mesmoCaminho, RESERVED, MAX_NOTE_CONTENT };
