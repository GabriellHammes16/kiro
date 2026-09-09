'use strict';
// Validador do subconjunto de JSON Schema usado pelas ferramentas.
// Pequeno de propósito: evita puxar um validador completo para uma superfície fechada.
const { AgentError } = require('./security.cjs');

const tipoDe = valor => Array.isArray(valor) ? 'array' : valor === null ? 'null' : typeof valor;

function validarCampo(valor, esquema, caminho) {
  const onde = caminho || 'entrada';
  if (esquema.type && tipoDe(valor) !== esquema.type) {
    if (!(esquema.type === 'integer' && Number.isInteger(valor))) {
      throw new AgentError('INVALID_INPUT', `"${onde}" deveria ser ${esquema.type}, veio ${tipoDe(valor)}.`);
    }
  }
  if (esquema.enum && !esquema.enum.includes(valor)) {
    throw new AgentError('INVALID_INPUT', `"${onde}" deve ser um de: ${esquema.enum.join(', ')}.`);
  }
  if (esquema.type === 'string') {
    if (esquema.maxLength !== undefined && valor.length > esquema.maxLength) {
      throw new AgentError('INVALID_INPUT', `"${onde}" passa de ${esquema.maxLength} caracteres.`);
    }
    if (esquema.minLength !== undefined && valor.length < esquema.minLength) {
      throw new AgentError('INVALID_INPUT', `"${onde}" precisa de ao menos ${esquema.minLength} caractere(s).`);
    }
  }
  if (esquema.type === 'integer' || esquema.type === 'number') {
    if (esquema.minimum !== undefined && valor < esquema.minimum) {
      throw new AgentError('INVALID_INPUT', `"${onde}" precisa ser no mínimo ${esquema.minimum}.`);
    }
    if (esquema.maximum !== undefined && valor > esquema.maximum) {
      throw new AgentError('INVALID_INPUT', `"${onde}" precisa ser no máximo ${esquema.maximum}.`);
    }
  }
  if (esquema.type === 'array') {
    if (esquema.maxItems !== undefined && valor.length > esquema.maxItems) {
      throw new AgentError('INVALID_INPUT', `"${onde}" aceita no máximo ${esquema.maxItems} itens.`);
    }
    if (esquema.items) valor.forEach((item, i) => validarCampo(item, esquema.items, `${onde}[${i}]`));
  }
}

/** Valida os argumentos de uma ferramenta e recusa campos desconhecidos. */
function validate(args, esquema) {
  const entrada = args === undefined || args === null ? {} : args;
  if (tipoDe(entrada) !== 'object') throw new AgentError('INVALID_INPUT', 'Os argumentos devem ser um objeto.');
  const propriedades = esquema.properties || {};
  for (const chave of Object.keys(entrada)) {
    if (!Object.prototype.hasOwnProperty.call(propriedades, chave)) {
      throw new AgentError('INVALID_INPUT', `Campo desconhecido: "${chave}". Aceitos: ${Object.keys(propriedades).join(', ') || '(nenhum)'}.`);
    }
  }
  for (const obrigatorio of esquema.required || []) {
    if (entrada[obrigatorio] === undefined || entrada[obrigatorio] === null) {
      throw new AgentError('INVALID_INPUT', `Campo obrigatório ausente: "${obrigatorio}".`);
    }
  }
  const saida = {};
  for (const [chave, sub] of Object.entries(propriedades)) {
    if (entrada[chave] === undefined || entrada[chave] === null) {
      if (sub.default !== undefined) saida[chave] = sub.default;
      continue;
    }
    validarCampo(entrada[chave], sub, chave);
    saida[chave] = entrada[chave];
  }
  return saida;
}

module.exports = { validate };
