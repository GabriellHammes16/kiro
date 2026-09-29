const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('main: pt-BR e en-US juntos, só os que existem, depois que a página carrega', () => {
  const main = ler('electron/main.cjs');
  assert.ok(main.includes("const IDIOMAS_DO_CORRETOR = ['pt-BR', 'en-US'];"));
  assert.ok(/availableSpellCheckerLanguages/.test(main));
  assert.ok(/webContents\.once\('did-finish-load'/.test(main), 'os dicionários entram depois da janela carregar');
  assert.ok(/setSpellCheckerLanguages\(/.test(main));
});

test('main: canais do corretor validam o que a página manda', () => {
  const main = ler('electron/main.cjs');
  assert.ok(/ipcMain\.on\('corretor:definir', \(event, ligado\) => event\.sender\.session\.setSpellCheckerEnabled\(ligado === true\)\)/.test(main));
  assert.ok(/ipcMain\.on\('corretor:trocar'[^\n]*palavraValida\(palavra\)[^\n]*replaceMisspelling\(palavra\)/.test(main));
  assert.ok(/ipcMain\.on\('corretor:adicionar'[^\n]*palavraParaDicionario\(palavra\)[^\n]*addWordToSpellCheckerDictionary\(palavra\)/.test(main));
  assert.ok(/on\('context-menu'[\s\S]{0,300}send\('corretor:menu'/.test(main), 'o botão direito devolve palavra e sugestões à página');
});

test('preload expõe só os canais do corretor e do idioma', () => {
  const preload = ler('electron/preload.cjs');
  for (const trecho of ["definirCorretor: ligado => ipcRenderer.send('corretor:definir', ligado === true)", "trocarPalavra: palavra => ipcRenderer.send('corretor:trocar', palavra)", "adicionarAoDicionario: palavra => ipcRenderer.send('corretor:adicionar', palavra)", "definirIdioma: codigo => ipcRenderer.send('idioma:definir', codigo)"])
    assert.ok(preload.includes(trecho), trecho);
  assert.ok(/aoMenuDoCorretor: fn => ipcRenderer\.on\('corretor:menu', \(_evento, dados\) => fn\(dados\)\)/.test(preload));
});

test('página: interruptor do corretor e Shift+botão direito deixa o menu nativo', () => {
  const app = ler('app.js');
  assert.ok(app.includes("lerPreferencia('corretor') !== '0'"), 'ligado por padrão');
  assert.ok(app.includes('id="cfg-corretor"'));
  assert.ok(/if \(evento\.shiftKey\) return;/.test(app), 'Shift + botão direito: menu do navegador');
});
