const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('canais do dicionário pessoal no app e na web', () => {
  const main = ler('electron/main.cjs'), preload = ler('electron/preload.cjs'), servidor = ler('server.mjs');
  assert.ok(/ipcMain\.handle\('dicionario:get', \(\) => vault\.readDictionary\(\)\)/.test(main));
  assert.ok(/ipcMain\.handle\('dicionario:add', \(_event, palavra\) => vault\.addToDictionary\(palavra\)\)/.test(main));
  assert.ok(preload.includes("dicionario: () => ipcRenderer.invoke('dicionario:get')"));
  assert.ok(preload.includes("adicionarAoDicionarioDoCofre: palavra => ipcRenderer.invoke('dicionario:add', palavra)"));
  assert.ok(servidor.includes("'/api/dicionario'"));
});
