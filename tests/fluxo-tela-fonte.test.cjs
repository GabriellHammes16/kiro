const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fonte = fs.readFileSync(path.join(__dirname, '../fluxo-tela.js'), 'utf8');

test('copiar e recortar respeitam o texto em edição', () => {
  for (const evento of ['copy', 'cut']) {
    const i = fonte.indexOf(`raiz.addEventListener('${evento}'`);
    assert.ok(i > 0, evento);
    assert.match(fonte.slice(i, i + 160), /editor \|\| e\.target !== raiz/);
  }
});

test('a área do fluxo só vale quando o texto copiado ainda é o mesmo', () => {
  assert.match(fonte, /areaDoFluxo\?\.texto === /);
});

test('o atalho de criar balão é lido antes do editor, em captura', () => {
  assert.ok(fonte.includes("opcoes.atalho?.('fluxoProximo')"));
  assert.match(fonte, /campo\.addEventListener\('keydown', aoCriarVizinho, true\)/);
});

test('Enter sozinho não cria balão', () => {
  assert.doesNotMatch(fonte, /e\.key === 'Enter'[^\n]*criarVizinho/);
});

test('redimensionar à mão fixa a altura e a edição a respeita', () => {
  assert.match(fonte, /kiroAlturaFixa: true/);
  assert.match(fonte, /\.kiroAlturaFixa/);
});

test('as guias são limpas ao soltar e ao cancelar o gesto', () => {
  assert.ok((fonte.match(/limparGuias\(\)/g) || []).length >= 2);
});

test('PDF não é tratado como nota', () => {
  assert.match(fonte, /F\.tipoDoArquivo\(c\.file\) !== 'nota'/);
  assert.doesNotMatch(fonte, /type === 'file' && !F\.ehImagem\(no\(idNo\)\.file\) \?/);
});

test('o corpo do arquivo (PDF, vídeo) reaproveita o elemento para não piscar ao redesenhar', () => {
  const i = fonte.indexOf('function desenhar()');
  assert.match(fonte.slice(i, i + 1200), /data-reusar/);
});

test('rolar as páginas não é capturado pelo Fluxo', () => {
  const i = fonte.indexOf("raiz.addEventListener('wheel'");
  assert.match(fonte.slice(i, i + 300), /md-pdf-paginas/);
});

test('Copiar e Recortar do menu não usam execCommand', () => {
  assert.doesNotMatch(fonte, /execCommand/);
  assert.match(fonte, /rotulo: t\('Copiar'\)[^\n]*copiarSelecao\(\)/);
  assert.match(fonte, /rotulo: t\('Recortar'\)[^\n]*removerCartoes\(canvas, copiarSelecao\(\)\)/);
});

test('segurar o atalho de balão não cria um cartão por repetição', () => {
  assert.match(fonte, /e\.repeat/);
});

test('cartao de arquivo recolhe pelo modelo e reaproveita o corpo ja desenhado', () => {
  assert.ok(fonte.includes('F.alternarRecolhido('));
  assert.ok(fonte.includes('data-reusar'));
});

test('o Fluxo escolhe os arquivos aceitos por uma lista propria', () => {
  assert.ok(fonte.includes('opcoes.arquivosDoEvento'));
  assert.doesNotMatch(fonte, /opcoes\.imagensColadas/);
});

test('as notas continuam so com imagem e PDF: imagensDoEvento filtra por TIPOS_DE_IMAGEM', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const i = app.indexOf('function imagensDoEvento');
  assert.ok(i > 0);
  assert.match(app.slice(i, i + 400), /TIPOS_DE_IMAGEM\.includes/);
  assert.doesNotMatch(app.slice(i, app.indexOf('async function guardarImagem(', i)), /tipoDoArquivo|TIPOS_DO_FLUXO/);
});

test('os corpos reaproveitaveis ficam na sessao, para o autosave nao parar a midia', () => {
  assert.match(fonte, /corpos: new Map\(\)/);
  const i = fonte.indexOf('function desenhar()');
  const corpo = fonte.slice(i, fonte.indexOf('function alturaDoTexto', i));
  assert.match(corpo, /s\.corpos = new Map\(\)/);
  assert.match(corpo, /new Map\(s\.corpos\)/);
});

test('link do YouTube vira cartao de video: miniatura, iframe do embed e corpo reaproveitado', () => {
  const i = fonte.indexOf('function linkHtml');
  assert.ok(i > 0);
  const corpo = fonte.slice(i, fonte.indexOf('function arquivoHtml', i));   // linkHtml e videoHtml
  assert.ok(corpo.includes('F.idDoYoutube('));
  assert.ok(corpo.includes('data-reusar'));
  assert.ok(corpo.includes('i.ytimg.com/vi/'));
  assert.ok(fonte.includes('youtube-nocookie.com/embed/'));   // o iframe, que o cartão e a tela inteira compartilham
});

test('a CSP libera so o embed e a miniatura do YouTube, e o main manda o Referer do embed', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(html.includes("frame-src 'self' kiro-plugin: https://www.youtube-nocookie.com;"));
  assert.match(html, /img-src [^;]*https:\/\/i\.ytimg\.com/);
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.ok(main.includes("'https://www.youtube-nocookie.com/*'") && main.includes('Referer'));
});
