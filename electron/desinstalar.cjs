// Versão em .zip: o próprio Kiro aparece em "Aplicativos instalados" do Windows e sabe se desinstalar.
// Só apaga a pasta do app (a que tem o Kiro.exe e o app do Kiro dentro), o atalho do Menu Iniciar, o
// registro na lista do Windows e as configurações. O cofre (as notas) nunca entra na conta.
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');

const CHAVE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KiroZip';
const DESINSTALADOR_DO_INSTALADOR = 'Uninstall Kiro.exe';

const dentro = (filho, pai) => { const a = resolve(filho).toLowerCase(), b = resolve(pai).toLowerCase(); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };

/** A pasta só é apagada se for mesmo a do Kiro e não tiver relação com o cofre. Devolve o motivo da recusa, ou ''. */
function motivoParaNaoApagar(pastaDoApp, cofre, configuracoes) {
  if (!existsSync(join(pastaDoApp, 'Kiro.exe'))) return 'sem Kiro.exe';
  let nome = '';
  try { nome = JSON.parse(readFileSync(join(pastaDoApp, 'resources', 'app', 'package.json'), 'utf8')).name; } catch { /* sem package.json */ }
  if (nome !== 'kiro') return 'não é a pasta do Kiro';
  for (const [a, b] of [[pastaDoApp, 'app'], [configuracoes, 'configurações']]) {
    if (cofre && (dentro(cofre, a) || dentro(a, cofre))) return `o cofre está junto da pasta de ${b}`;
  }
  if (resolve(pastaDoApp).split(sep).filter(Boolean).length < 3) return 'pasta curta demais';
  // O script é um .cmd: % e " mudariam o caminho.
  if ([pastaDoApp, configuracoes].some(p => /[%"!^]/.test(p))) return 'caminho com caractere especial';
  return '';
}

/** Script que espera o Kiro fechar e então apaga as pastas. Só monta o texto; quem roda é o main. */
function scriptDeRemocao(pid, pastas) {
  return [
    '@echo off',
    ':esperar',
    // Caminho completo: outro "find" no PATH (o do Git, por exemplo) não entende estas opções.
    `"%SystemRoot%\\System32\\tasklist.exe" /FI "PID eq ${Number(pid)}" /NH 2>nul | "%SystemRoot%\\System32\\find.exe" " ${Number(pid)} " >nul && ("%SystemRoot%\\System32\\ping.exe" -n 2 127.0.0.1 >nul & goto esperar)`,
    ...pastas.map(p => `rmdir /s /q "${p}"`),
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n');
}

/** Valores do registro em "Aplicativos instalados". */
function valoresDoRegistro({ exe, icone, versao, pasta }) {
  return [
    ['DisplayName', 'REG_SZ', 'Kiro'],
    ['DisplayIcon', 'REG_SZ', icone],
    ['DisplayVersion', 'REG_SZ', versao],
    ['Publisher', 'REG_SZ', 'Kiro'],
    ['InstallLocation', 'REG_SZ', pasta],
    ['UninstallString', 'REG_SZ', `"${exe}" --desinstalar`],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
  ];
}

module.exports = { CHAVE, DESINSTALADOR_DO_INSTALADOR, motivoParaNaoApagar, scriptDeRemocao, valoresDoRegistro };
