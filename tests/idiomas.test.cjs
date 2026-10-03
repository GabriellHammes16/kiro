const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../idiomas.js');
const C = require('../corretor.js');

const EN = { 'Sem título': 'Untitled', 'editada {quando}': 'edited {quando}', 'Olá, {nome}': 'Hi, {nome}' };
test.beforeEach(() => { I.registrar('en', EN); I.definirIdioma('pt-BR'); });

test('em português t() devolve a própria frase, com os marcadores trocados', () => {
  assert.equal(I.t('Sem título'), 'Sem título');
  assert.equal(I.t('editada {quando}', { quando: 'ontem' }), 'editada ontem');
});

test('em inglês t() traduz; sem tradução, cai no português', () => {
  I.definirIdioma('en');
  assert.equal(I.t('Sem título'), 'Untitled');
  assert.equal(I.t('Olá, {nome}', { nome: 'Ana' }), 'Hi, Ana');
  assert.equal(I.t('Frase que ninguém traduziu'), 'Frase que ninguém traduziu');
});

test('valor com chaves não é substituído de novo', () => {
  I.definirIdioma('en');
  assert.equal(I.t('editada {quando}', { quando: '{nome}' }), 'edited {nome}');
});

test('marcador sem valor fica como está', () => {
  assert.equal(I.t('Olá, {nome}', {}), 'Olá, {nome}');
});

test('frase com nome de Object.prototype não vira função', () => {
  I.definirIdioma('en');
  assert.equal(I.t('constructor'), 'constructor');
  assert.equal(I.t('toString'), 'toString');
});

test('frase() só marca: devolve a entrada', () => {
  assert.equal(I.frase('Aparência'), 'Aparência');
});

test('código desconhecido cai no padrão', () => {
  assert.equal(I.definirIdioma('xx'), 'pt-BR');
  assert.equal(I.idioma(), 'pt-BR');
  assert.equal(I.locale(), 'pt-BR');
  I.definirIdioma('en');
  assert.equal(I.locale(), 'en-US');
});

test('detectar e escolherIdioma: salvo válido vence, senão o sistema, senão português', () => {
  assert.equal(I.detectar('en-GB'), 'en');
  assert.equal(I.detectar('EN'), 'en');
  assert.equal(I.detectar('pt-PT'), 'pt-BR');
  assert.equal(I.detectar('ja-JP'), 'pt-BR');
  assert.equal(I.detectar(undefined), 'pt-BR');
  assert.equal(I.escolherIdioma('en', 'pt-BR'), 'en');
  assert.equal(I.escolherIdioma('xx', 'en-US'), 'en');
  assert.equal(I.escolherIdioma(null, 'fr-FR'), 'pt-BR');
});

test('carregar: português e idioma já registrado não importam nada; o resto importa uma vez', async () => {
  const pedidos = [];
  const importar = async codigo => { pedidos.push(codigo); };
  await I.carregar('pt-BR', importar);
  await I.carregar('en', importar);            // já registrado no beforeEach
  await I.carregar('xx', importar);            // desconhecido
  assert.deepEqual(pedidos, []);
});

test('carregar: idioma ainda não registrado chama o importador; a falha dele chega a quem pediu', async () => {
  delete require.cache[require.resolve('../idiomas.js')];
  const limpo = require('../idiomas.js');   // instância nova, sem 'en' registrado
  const pedidos = [];
  await limpo.carregar('en', async codigo => { pedidos.push(codigo); });
  assert.deepEqual(pedidos, ['en']);
  await assert.rejects(limpo.carregar('en', async () => { throw new Error('falhou'); }), /falhou/);
});

test('formatarData e comparar seguem o idioma e o cache é refeito na troca', () => {
  const data = new Date('2026-09-28T12:00:00');
  const opcoes = { day: 'numeric', month: 'long' };
  assert.equal(I.formatarData(data, opcoes), '28 de setembro');
  I.definirIdioma('en');
  assert.equal(I.formatarData(data, opcoes), 'September 28');
  assert.ok(I.comparar('Nota 2', 'Nota 10') < 0, 'numérico');
  I.definirIdioma('pt-BR');
  assert.ok(I.comparar('ábaco', 'bola') < 0, 'acento não joga para o fim');
});

test('itensDoCorretor: sem palavra, nada; com palavra, sugestões e adicionar', () => {
  const feito = [];
  const acoes = { trocar: s => feito.push(['trocar', s]), adicionar: p => feito.push(['adicionar', p]), t: I.t };
  assert.deepEqual(C.itensDoCorretor({ palavra: '' }, acoes), []);
  assert.deepEqual(C.itensDoCorretor(null, acoes), []);
  const itens = C.itensDoCorretor({ palavra: 'errrado', sugestoes: ['errado', 'errada', 'erro', 'ferrado', 'serrado', 'aterrado'] }, acoes);
  assert.deepEqual(itens.map(i => i.rotulo), ['errado', 'errada', undefined, 'Adicionar ao dicionário']);
  assert.equal(itens[2].separador, true);
  itens[0].acao(); itens[3].acao();
  assert.deepEqual(feito, [['trocar', 'errado'], ['adicionar', 'errrado']]);
});

test('itensDoCorretor: sem sugestões mostra um item desabilitado; lixo na lista é ignorado', () => {
  const acoes = { trocar() {}, adicionar() {}, t: I.t };
  const itens = C.itensDoCorretor({ palavra: 'xyzq', sugestoes: [null, '', 3] }, acoes);
  assert.equal(itens[0].rotulo, 'Sem sugestões');
  assert.equal(itens[0].ativo(), false);
  assert.equal(itens.length, 3);
});

test('palavraValida e palavraParaDicionario recusam o que não é palavra curta', () => {
  assert.equal(C.palavraValida('errado'), true);
  assert.equal(C.palavraValida('a gente'), true);
  assert.equal(C.palavraValida(''), false);
  assert.equal(C.palavraValida('x'.repeat(101)), false);
  assert.equal(C.palavraValida('duas\nlinhas'), false);
  assert.equal(C.palavraValida(42), false);
  assert.equal(C.palavraParaDicionario('Kiro'), true);
  assert.equal(C.palavraParaDicionario('a gente'), false);
});

test('semPrefixoDoIpc tira o prefixo que o Electron põe nos erros', () => {
  assert.equal(I.semPrefixoDoIpc("Error invoking remote method 'vault:save': Error: O cofre mudou."), 'O cofre mudou.');
  assert.equal(I.semPrefixoDoIpc("Error invoking remote method 'x': O cofre mudou."), 'O cofre mudou.');
  assert.equal(I.semPrefixoDoIpc('O cofre mudou.'), 'O cofre mudou.');
  assert.equal(I.semPrefixoDoIpc(undefined), '');
});
