const test = require('node:test');
const assert = require('node:assert/strict');
const { ATALHOS_EDITAVEIS, atalhosValidos, combinacaoDoEvento, problemaDoAtalho, rotuloDaCombinacao } = require('../domain.js');

const tecla = (key, extra = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
const PADRAO = Object.fromEntries(ATALHOS_EDITAVEIS.map(([id, , , padrao]) => [id, padrao]));

test('padrões incluem o atalho da barra lateral', () => {
  assert.deepEqual(PADRAO, { captura: 'Ctrl+Space', irPara: 'Ctrl+O', novaNota: 'Ctrl+N', salvar: 'Ctrl+S', lateral: 'Ctrl+\\', painelDireito: 'Ctrl+Shift+L', acoesRapidas: 'Ctrl+K', fecharAba: 'Ctrl+W', novaAba: 'Ctrl+T', imprimir: 'Ctrl+P', configuracoes: 'Ctrl+,' });
});

test('combinação sai do evento de teclado, com Cmd valendo Ctrl', () => {
  assert.equal(combinacaoDoEvento(tecla('o', { ctrlKey: true })), 'Ctrl+O');
  assert.equal(combinacaoDoEvento(tecla('o', { metaKey: true })), 'Ctrl+O');
  assert.equal(combinacaoDoEvento(tecla(' ', { code: 'Space', ctrlKey: true })), 'Ctrl+Space');
  assert.equal(combinacaoDoEvento(tecla('K', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+K');
  assert.equal(combinacaoDoEvento(tecla('\\', { ctrlKey: true })), 'Ctrl+\\');
  assert.equal(combinacaoDoEvento(tecla('F2')), 'F2');
  assert.equal(combinacaoDoEvento(tecla('b', { altKey: true })), 'Alt+B');
  // Só o modificador ainda não é combinação: espera a próxima tecla.
  for (const k of ['Control', 'Shift', 'Alt', 'Meta']) assert.equal(combinacaoDoEvento(tecla(k, { ctrlKey: true })), null);
});

test('rótulo legível em português', () => {
  assert.equal(rotuloDaCombinacao('Ctrl+Space'), 'Ctrl + Espaço');
  assert.equal(rotuloDaCombinacao('Ctrl+Shift+K'), 'Ctrl + Shift + K');
  assert.equal(rotuloDaCombinacao('Ctrl+\\'), 'Ctrl + \\');
});

test('atalho novo precisa de Ctrl ou Alt, não pode ser de edição nem repetido', () => {
  assert.equal(problemaDoAtalho('Ctrl+J', PADRAO, 'irPara'), '');
  assert.equal(problemaDoAtalho('F2', PADRAO, 'irPara'), '');
  assert.equal(problemaDoAtalho('Ctrl+O', PADRAO, 'irPara'), '');       // o próprio atalho de volta
  assert.match(problemaDoAtalho('K', PADRAO, 'irPara'), /Ctrl ou Alt/);
  assert.match(problemaDoAtalho('Shift+K', PADRAO, 'irPara'), /Ctrl ou Alt/);
  assert.match(problemaDoAtalho('Ctrl+C', PADRAO, 'irPara'), /reservad/);
  assert.match(problemaDoAtalho('Ctrl+V', PADRAO, 'irPara'), /reservad/);
  assert.match(problemaDoAtalho('Ctrl+N', PADRAO, 'irPara'), /Nova nota/);
  assert.match(problemaDoAtalho('Escape', PADRAO, 'irPara'), /Ctrl ou Alt/);
});

test('atalhos salvos: inválido, repetido ou desconhecido volta ao padrão', () => {
  assert.deepEqual(atalhosValidos(undefined), PADRAO);
  assert.deepEqual(atalhosValidos('lixo'), PADRAO);
  assert.deepEqual(atalhosValidos({ irPara: 'Ctrl+K' }), { ...PADRAO, irPara: 'Ctrl+K', acoesRapidas: 'Ctrl+Shift+P' });
  assert.equal(atalhosValidos({ irPara: 'Ctrl+K' }).acoesRapidas, 'Ctrl+Shift+P');
  assert.equal(atalhosValidos({ irPara: 'Ctrl+K', salvar: 'Ctrl+Shift+P' }).acoesRapidas, 'Ctrl+Alt+K');
  assert.equal(atalhosValidos({ irPara: 'Ctrl+K', salvar: 'Ctrl+Shift+P', captura: 'Ctrl+Alt+K' }).acoesRapidas, 'F1');
  assert.equal(atalhosValidos({ irPara: 'Ctrl+K', acoesRapidas: 'Alt+Q' }).acoesRapidas, 'Alt+Q');
  assert.equal(new Set(Object.values(atalhosValidos({ irPara: 'Ctrl+K' }))).size, ATALHOS_EDITAVEIS.length);
  assert.deepEqual(atalhosValidos({ irPara: 'K', inventado: 'Ctrl+J' }), PADRAO);
  assert.deepEqual(atalhosValidos({ irPara: 'Ctrl+N' }), PADRAO);        // colidiria com Nova nota
  // Troca entre dois: ambos continuam válidos.
  assert.deepEqual(atalhosValidos({ irPara: 'Ctrl+N', novaNota: 'Ctrl+O' }), { ...PADRAO, irPara: 'Ctrl+N', novaNota: 'Ctrl+O' });
});
