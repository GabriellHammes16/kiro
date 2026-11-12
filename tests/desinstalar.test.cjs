const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { motivoParaNaoApagar, scriptDeRemocao, valoresDoRegistro } = require('../electron/desinstalar.cjs');

// Uma pasta com cara de Kiro extraído do .zip.
function pastaDeKiro(raiz, nome = 'kiro') {
  const pasta = path.join(raiz, 'Apps', 'Kiro');
  fs.mkdirSync(path.join(pasta, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'Kiro.exe'), '');
  fs.writeFileSync(path.join(pasta, 'resources', 'app', 'package.json'), JSON.stringify({ name: nome }));
  return pasta;
}

test('só aceita apagar a pasta do Kiro, longe do cofre', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-desinst-'));
  try {
    const app = pastaDeKiro(raiz), config = path.join(raiz, 'AppData', 'Kiro'), cofre = path.join(raiz, 'Documents', 'Kiro', 'vault');
    assert.equal(motivoParaNaoApagar(app, cofre, config), '');
    assert.notEqual(motivoParaNaoApagar(path.join(app, 'vault-dentro'), cofre, config), '', 'pasta sem Kiro.exe');
    assert.notEqual(motivoParaNaoApagar(app, path.join(app, 'notas'), config), '', 'cofre dentro da pasta do app');
    assert.notEqual(motivoParaNaoApagar(app, raiz, config), '', 'pasta do app dentro do cofre');
    assert.notEqual(motivoParaNaoApagar(app, path.join(config, 'vault'), config), '', 'cofre dentro das configurações');
    const outro = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-desinst-'));
    assert.notEqual(motivoParaNaoApagar(pastaDeKiro(outro, 'outro-app'), cofre, config), '', 'package.json de outro app');
    fs.rmSync(outro, { recursive: true, force: true });
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('o registro aponta o Desinstalar para o próprio Kiro.exe', () => {
  const v = Object.fromEntries(valoresDoRegistro({ exe: 'C:\\Apps\\Kiro\\Kiro.exe', icone: 'x.ico', versao: '1.2.3', pasta: 'C:\\Apps\\Kiro' }).map(([n, , d]) => [n, d]));
  assert.equal(v.UninstallString, '"C:\\Apps\\Kiro\\Kiro.exe" --desinstalar');
  assert.equal(v.DisplayName, 'Kiro');
  assert.equal(v.DisplayVersion, '1.2.3');
});

test('o script espera o processo fechar e só então apaga as pastas', { skip: process.platform !== 'win32' }, async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-desinst-'));
  try {
    const a = path.join(raiz, 'app'), b = path.join(raiz, 'config'), fica = path.join(raiz, 'cofre');
    for (const p of [a, b, fica]) { fs.mkdirSync(path.join(p, 'sub'), { recursive: true }); fs.writeFileSync(path.join(p, 'sub', 'x.txt'), 'x'); }
    const kiro = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2500)']);
    const script = path.join(raiz, 'remover.cmd');
    fs.writeFileSync(script, scriptDeRemocao(kiro.pid, [a, b]));
    const inicio = Date.now();
    const r = spawnSync('cmd.exe', ['/c', script], { windowsHide: true, timeout: 20000 });
    assert.equal(r.status, 0);
    assert.ok(Date.now() - inicio >= 1500, 'esperou o processo terminar');
    assert.equal(fs.existsSync(a), false);
    assert.equal(fs.existsSync(b), false);
    assert.equal(fs.existsSync(path.join(fica, 'sub', 'x.txt')), true, 'o que não está na lista fica');
    assert.equal(fs.existsSync(script), false, 'o script se apaga');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
