const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../examples/plugins/slides');
const model = require(path.join(dir, 'modelo.js'));

test('cada título # ou ## começa um slide e o texto até o próximo título é o conteúdo', () => {
  const slides = model.split('# Abertura\nOlá **mundo**\n\n## Parte dois\n- um\n- dois\n### Sub não é título');
  assert.deepEqual(slides, [
    { title: 'Abertura', body: 'Olá **mundo**' },
    { title: 'Parte dois', body: '- um\n- dois\n### Sub não é título' },
  ]);
  assert.deepEqual(model.split('#sem espaço\n####\n# Único').map(s => s.title), ['', 'Único'], 'sem espaço e #### não são títulos');
});

test('linha --- sozinha quebra slide; --- dentro de cerca de código não quebra', () => {
  const slides = model.split('# A\nx\n---\ny\n```\n---\n# falso\n```\n---\n# B');
  assert.deepEqual(slides.map(s => s.title), ['A', '', 'B']);
  assert.equal(slides[0].body, 'x');
  assert.equal(slides[1].body, 'y\n```\n---\n# falso\n```');
  assert.equal(model.split('a\n----\nb').length, 1, 'quatro hifens não são separador');
});

test('nota sem títulos vira um slide só, mesmo vazia', () => {
  assert.deepEqual(model.split('Só um texto\ncom duas linhas'), [{ title: '', body: 'Só um texto\ncom duas linhas' }]);
  assert.deepEqual(model.split(''), [{ title: '', body: '' }]);
  assert.deepEqual(model.split(undefined), [{ title: '', body: '' }]);
});

test('conteúdo antes do primeiro título vira slide próprio, sem título', () => {
  assert.deepEqual(model.split('Intro\n\n# Depois\nCorpo'), [
    { title: '', body: 'Intro' },
    { title: 'Depois', body: 'Corpo' },
  ]);
  assert.deepEqual(model.split('---\n# Só título'), [{ title: 'Só título', body: '' }]);
});

test('blocos: parágrafos, listas, código e inline sem HTML', () => {
  const blocks = model.blocks('Linha um\nlinha dois\n\n1. primeiro\n2. segundo\n\n```js\nx *y*\n```\n\n- a');
  assert.deepEqual(blocks.map(b => b.type), ['p', 'ol', 'code', 'ul']);
  assert.equal(blocks[0].text, 'Linha um linha dois');
  assert.deepEqual(blocks[1].items, ['primeiro', 'segundo']);
  assert.equal(blocks[2].text, 'x *y*');
  assert.deepEqual(model.inline('Oi **forte**, *itálico* e `cód` <b>'), [
    { type: 'text', text: 'Oi ' },
    { type: 'strong', text: 'forte' },
    { type: 'text', text: ', ' },
    { type: 'em', text: 'itálico' },
    { type: 'text', text: ' e ' },
    { type: 'code', text: 'cód' },
    { type: 'text', text: ' <b>' },
  ]);
});

test('busca por título ignora caixa e acento', () => {
  const notes = [{ title: 'Ação Estratégica' }, { title: 'Diário' }, { title: '' }];
  assert.deepEqual(model.filter(notes, 'acao').map(n => n.title), ['Ação Estratégica']);
  assert.deepEqual(model.filter(notes, 'DIÁRIO').map(n => n.title), ['Diário']);
  assert.equal(model.filter(notes, '').length, 3);
});

test('manifesto pede só leitura de notas, sem rede, e página aponta para page.html', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['notes:read']);
  assert.deepEqual(manifest.network, []);
  assert.equal(manifest.page.file, 'page.html');
  assert.ok(fs.existsSync(path.join(dir, 'index.js')));
});

test('a página não injeta HTML da nota e libera listeners ao fechar', () => {
  const page = fs.readFileSync(path.join(dir, 'page.js'), 'utf8');
  assert.doesNotMatch(page, /\binnerHTML\b|insertAdjacentHTML|document\.write/);
  assert.match(page, /textContent/);
  assert.match(page, /pagehide.*eventos\.abort/s);
  assert.match(page, /e\.key === 'Escape'[\s\S]*?sair\(\)/);
});
