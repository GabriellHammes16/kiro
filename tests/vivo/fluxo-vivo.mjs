// Testes do Fluxo no app de verdade: abre o Electron no cofre de desenvolvimento (--dev-vault), com um perfil
// temporário, e confere cada comportamento pelo DevTools Protocol. Fica fora do `npm test` porque precisa de
// tela. Rode com `npm run test:vivo`; com `-- --internet`, roda também a prévia de link e o YouTube.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COFRE = path.join(RAIZ, 'dev-vault');
const COM_INTERNET = process.argv.includes('--internet');
const PORTA = 9400 + Math.floor(Math.random() * 400);
const PERFIL = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-vivo-'));
const ELECTRON = path.join(RAIZ, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const espera = ms => new Promise(r => setTimeout(r, ms));
const resultados = [];
const ok = (nome, passou, detalhe) => { resultados.push(!!passou); console.log(`${passou ? 'ok  ' : 'FALHA'} ${nome}${passou || detalhe === undefined ? '' : ' — ' + JSON.stringify(detalhe)}`); };
const erros = [];

// ---- DevTools Protocol ----
const conectar = url => new Promise((res, no) => {
  const ws = new WebSocket(url); let id = 0; const p = new Map();
  ws.onopen = () => res({ env: (m, q = {}) => new Promise((a, b) => { const i = ++id; p.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method: m, params: q })); }), fechar: () => ws.close() });
  ws.onerror = () => no(new Error('ws'));
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') erros.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') erros.push(d.params.args.map(a => a.value ?? a.description).join(' '));
    const e = p.get(d.id); if (e) { p.delete(d.id); d.error ? e[1](new Error(d.error.message)) : e[0](d.result); }
  };
});
let c;
const pagina = async () => {
  for (let i = 0; i < 60; i++) {
    try { const a = (await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json()).find(t => t.type === 'page'); if (a) { c?.fechar(); c = await conectar(a.webSocketDebuggerUrl); await c.env('Runtime.enable'); return; } } catch { /* ainda abrindo */ }
    await espera(500);
  }
  throw new Error('O Kiro não abriu.');
};
const ev = async e => { const r = await c.env('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const MOD = { alt: 1, ctrl: 2, shift: 8 };
async function tecla(key, mods = [], commands) {
  const modifiers = mods.reduce((s, m) => s | MOD[m], 0), code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const vk = { Enter: 13, Escape: 27 }[key] ?? key.toUpperCase().charCodeAt(0);
  await c.env('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
  if (key === 'Enter' && !mods.includes('ctrl') && !mods.includes('alt')) await c.env('Input.dispatchKeyEvent', { type: 'char', text: '\r', key, code, windowsVirtualKeyCode: 13, modifiers });
  await c.env('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await espera(120);
}
const mouse = (type, x, y, extra = {}) => c.env('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !extra.buttons ? 'none' : (extra.button || 'left'), ...extra });
async function arrastar(x0, y0, x1, y1, noMeio) {
  await mouse('mouseMoved', x0, y0); await mouse('mousePressed', x0, y0, { clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, { buttons: 1 });
  const meio = noMeio ? await noMeio() : null;
  await mouse('mouseReleased', x1, y1, { clickCount: 1 }); await espera(150);
  return meio;
}
async function clicar(x, y, n = 1) { for (let i = 1; i <= n; i++) { await mouse('mousePressed', x, y, { clickCount: i, buttons: 1 }); await mouse('mouseReleased', x, y, { clickCount: i }); } await espera(150); }

// ---- Ajudas do Kiro ----
const canvas = (k = 'kiro.fv1') => ev(`getFluxo(localStorage.getItem('${k}')).canvas`);
const nos = async () => (await canvas()).nodes;
const novo = async antes => (await nos()).find(n => !antes.some(a => a.id === n.id));
const sel = id => `.fluxo-cartao[data-no="${id}"]`;
const caixa = id => ev(`(()=>{const r=document.querySelector('${sel(id)}')?.getBoundingClientRect();return r&&{x:r.left,y:r.top,w:r.width,h:r.height}})()`);
const focarFluxo = () => ev(`document.querySelector('.fluxo').focus()`);
const escreverNaArea = texto => ev(`(()=>{const t=document.createElement('textarea');t.value=${JSON.stringify(texto)};document.body.append(t);t.select();document.execCommand('copy');t.remove();document.querySelector('.fluxo').focus();})()`);
const abrir = async (k, extra = '') => { await ev(`abrirFluxo(getFluxo(localStorage.getItem('${k}'))${extra})`); await espera(900); };
const BASE = { nodes: [
  { id: 'a', type: 'text', text: 'Primeiro', x: 0, y: 0, width: 260, height: 60 },
  { id: 'b', type: 'text', text: 'Segundo', x: 400, y: 0, width: 260, height: 60 },
], edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' }] };
const recomecar = async (extra = []) => { await ev(`(async()=>{const f=getFluxo(localStorage.getItem('kiro.fv1'));const cv=${JSON.stringify(BASE)};cv.nodes.push(...${JSON.stringify(extra)});state.fluxos=state.fluxos.map(x=>x.id===f.id?{...x,canvas:cv}:x);await save();await abrirFluxo(getFluxo(f.id));})()`); await espera(1000); };
const colarArquivo = async (nome, tipo, bytes) => {
  await focarFluxo();
  await ev(`(()=>{const b=Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([b],${JSON.stringify(nome)},{type:${JSON.stringify(tipo)}}));document.querySelector('.fluxo').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
  await espera(1500);
};
const ligarInternet = ligado => ev(`(()=>{internetNoFluxo=${ligado};localStorage.setItem('kiro.internetNoFluxo','${ligado ? 1 : 0}');render();})()`).then(() => espera(1200));

// Amostras escritas aqui mesmo: PDF de 3 páginas, WAV de 20 s e um CSV de 1000 linhas.
function pdfDeTeste() {
  const obj = [], add = s => obj.push(s);
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>');
  for (let p = 1; p <= 3; p++) { const conteudo = `BT /F1 48 Tf 72 700 Td (Pagina ${p}) Tj ET`; add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${obj.length + 2} 0 R /Resources << /Font << /F1 9 0 R >> >> >>`); add(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`); }
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let s = '%PDF-1.4\n'; const off = [];
  obj.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n` + off.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${obj.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
function wavDeTeste(segundos = 20, taxa = 8000) {
  const dados = Buffer.alloc(segundos * taxa * 2);
  for (let i = 0; i < segundos * taxa; i++) dados.writeInt16LE(Math.round(Math.sin(i / taxa * 2 * Math.PI * 440) * 8000), i * 2);
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + dados.length, 4); cab.write('WAVE', 8); cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(taxa, 24); cab.writeUInt32LE(taxa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34); cab.write('data', 36); cab.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cab, dados]);
}
const PDF = pdfDeTeste(), WAV = wavDeTeste();

// ---- Abre o Kiro ----
const app = spawn(ELECTRON, ['.', '--dev-vault', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${PERFIL}`, '--disable-features=CalculateNativeWinOcclusion'], { cwd: RAIZ, stdio: 'ignore' });
let codigo = 1;
try {
  await espera(6000); await pagina(); await espera(800);
  ev(`(()=>{localStorage.removeItem('kiro.atalhos');localStorage.removeItem('kiro.internetNoFluxo');gravarAparencia({...lerAparencia(),tema:'kiro',skin:'padrao'});})()`).catch(() => {});
  await espera(4000); await pagina(); await espera(1000);
  await c.env('Page.bringToFront');
  await ev(`(async()=>{const f1={id:uid(),title:'Teste vivo 1',folderId:'',canvas:${JSON.stringify(BASE)}},f2={id:uid(),title:'Teste vivo 2',folderId:'',canvas:{nodes:[],edges:[]}};
    state.fluxos=[...state.fluxos,f1,f2];await save();localStorage.setItem('kiro.fv1',f1.id);localStorage.setItem('kiro.fv2',f2.id);await abrirFluxo(getFluxo(f1.id));})()`);
  await espera(1200);

  console.log('\n# Copiar e colar');
  let a = await caixa('a');
  await clicar(a.x + 20, a.y + 20); await focarFluxo();
  await tecla('a', ['ctrl']);
  ok('Ctrl+A seleciona tudo', (await ev(`document.querySelectorAll('.fluxo-cartao.selecionado').length`)) === 2);
  await mouse('mouseMoved', a.x + 100, a.y + 300);
  await tecla('c', ['ctrl'], ['copy']); await tecla('v', ['ctrl'], ['paste']); await espera(300);
  let cv = await canvas();
  ok('Ctrl+C e Ctrl+V levam os cartões e a seta', cv.nodes.length === 4 && cv.edges.length === 2, cv.nodes.length);
  await tecla('z', ['ctrl']); await espera(300); cv = await canvas();
  ok('Ctrl+Z desfaz a colagem em um passo', cv.nodes.length === 2 && cv.edges.length === 1);
  await focarFluxo(); await tecla('v', ['ctrl'], ['paste']); await espera(200); await tecla('v', ['ctrl'], ['paste']); await espera(300);
  await espera(3000); await focarFluxo(); await tecla('v', ['ctrl'], ['paste']); await espera(300);
  const tres = (await nos()).filter(n => n.text === 'Primeiro' && n.id !== 'a');
  ok('Colar de novo no mesmo ponto desloca, mesmo depois do autosave', new Set(tres.map(n => `${n.x},${n.y}`)).size === 3, tres.map(n => [n.x, n.y]));
  await recomecar();
  await escreverNaArea('texto de outro programa'); await tecla('v', ['ctrl'], ['paste']); await espera(400);
  ok('Texto copiado de fora vira cartão de texto', (await nos()).some(n => n.text === 'texto de outro programa'));
  a = await caixa('a'); await clicar(a.x + 20, a.y + 20); await focarFluxo(); await tecla('c', ['ctrl'], ['copy']);
  await abrir('kiro.fv2'); await focarFluxo(); await tecla('v', ['ctrl'], ['paste']); await espera(400);
  ok('Copiar num fluxo e colar em outro', (await canvas('kiro.fv2')).nodes.some(n => n.text === 'Primeiro'));
  await recomecar();
  const menu = async (id, rotulo) => {
    const r = await caixa(id);
    await mouse('mouseMoved', r.x + 30, r.y + 20);
    await mouse('mousePressed', r.x + 30, r.y + 20, { button: 'right', clickCount: 1, buttons: 2 }); await mouse('mouseReleased', r.x + 30, r.y + 20, { button: 'right', clickCount: 1 });
    await espera(300);
    const item = await ev(`(()=>{const b=[...document.querySelectorAll('.ctx-menu button, .ctx-menu [role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(rotulo)});if(!b)return null;const q=b.getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+q.height/2}})()`);
    if (item) { await clicar(item.x, item.y); await espera(300); }
    return !!item;
  };
  await escreverNaArea('antes');
  ok('Menu Copiar grava os cartões na área de transferência', await menu('a', 'Copiar') && (await ev(`navigator.clipboard.readText()`)) === 'Primeiro');
  ok('Menu Recortar remove o cartão', await menu('b', 'Recortar') && (await nos()).length === 1);
  await focarFluxo(); await tecla('v', ['ctrl'], ['paste']); await espera(400);
  ok('O recortado cola de volta', (await nos()).some(n => n.text === 'Segundo'));

  console.log('\n# Balões e atalhos');
  await recomecar();
  a = await caixa('a'); await clicar(a.x + 40, a.y + 30, 2); await espera(300);
  ok('Dois cliques abrem a edição', await ev(`!!document.querySelector('.fluxo-cartao.editando')`));
  await c.env('Input.insertText', { text: ' mais' });
  const antes = (await nos()).length;
  await tecla('Enter'); await espera(150);
  ok('Enter só quebra a linha', (await nos()).length === antes);
  await tecla('Enter', ['ctrl']); await espera(400);
  ok('Ctrl+Enter cria o próximo balão, já em edição', (await nos()).length === antes + 1 && await ev(`!!document.querySelector('.fluxo-cartao.editando')`));
  ok('O texto do balão anterior foi gravado', (await nos()).find(n => n.id === 'a').text.startsWith('Primeiro mais'));
  const setas = (await canvas()).edges.length;
  await c.env('Input.insertText', { text: 'filho' }); await tecla('Enter', ['ctrl', 'shift']); await espera(400);
  ok('Ctrl+Shift+Enter cria balão ligado', (await nos()).length === antes + 2 && (await canvas()).edges.length === setas + 1);
  await tecla('Escape'); await espera(300);
  await ev(`gravarAtalhos({...atalhos,fluxoProximo:'Alt+N'})`);
  const n0 = (await nos()).length;
  a = await caixa('a'); await clicar(a.x + 40, a.y + 30, 2); await espera(300);
  await tecla('Enter', ['ctrl']); await espera(300);
  ok('Trocar o atalho: o antigo deixa de criar balão', (await nos()).length === n0);
  await tecla('n', ['alt']); await espera(400);
  ok('Trocar o atalho: o novo cria o balão', (await nos()).length === n0 + 1);
  await tecla('Escape'); await ev(`gravarAtalhos({...atalhos,fluxoProximo:'Ctrl+Enter'})`);

  console.log('\n# Cartão que cresce e guias');
  await recomecar();
  a = await caixa('a'); await clicar(a.x + 40, a.y + 30, 2); await espera(300);
  const h0 = (await caixa('a')).h;
  for (let i = 0; i < 6; i++) { await tecla('Enter'); await c.env('Input.insertText', { text: `linha ${i}` }); }
  await espera(300);
  ok('O cartão cresce enquanto se digita', (await caixa('a')).h > h0 + 40);
  await espera(2600); await c.env('Input.insertText', { text: ' fim' }); await tecla('Escape'); await espera(400);
  ok('Digitar depois do autosave não perde texto', (await nos()).find(n => n.id === 'a').text.includes('linha 5 fim'));
  const bb = await caixa('b');
  await arrastar(bb.x + bb.w - 3, bb.y + bb.h - 3, bb.x + bb.w - 3, bb.y + bb.h + 117);
  const bFixo = (await nos()).find(n => n.id === 'b');
  ok('Redimensionar à mão fixa a altura', bFixo.kiroAlturaFixa === true);
  const b2 = await caixa('b'); await clicar(b2.x + 40, b2.y + 20, 2); await espera(300);
  for (let i = 0; i < 10; i++) { await tecla('Enter'); await c.env('Input.insertText', { text: `x${i}` }); }
  await tecla('Escape'); await espera(400);
  ok('Com altura fixa, digitar não muda a altura', (await nos()).find(n => n.id === 'b').height === bFixo.height);
  await recomecar();
  const zoom = await ev(`parseFloat(getComputedStyle(document.querySelector('.fluxo')).getPropertyValue('--zoom'))||1`);
  const bA = await caixa('b'), aA = await caixa('a');
  const guias = await arrastar(bA.x + 30, bA.y + 20, bA.x + 30 + aA.x + 3 * zoom - bA.x, bA.y + 20 + 200 * zoom, () => ev(`document.querySelectorAll('.fluxo-guia').length`));
  ok('A guia aparece ao arrastar perto do alinhamento', guias > 0);
  ok('A guia encaixa a borda', (await nos()).find(n => n.id === 'b').x === 0);
  ok('A guia some ao soltar', (await ev(`document.querySelectorAll('.fluxo-guia').length`)) === 0);

  console.log('\n# Arquivos');
  await recomecar();
  let antesA = await nos();
  await colarArquivo('teste.pdf', 'application/pdf', PDF);
  const pdfNo = await novo(antesA);
  ok('PDF novo entra recolhido', pdfNo?.kiroRecolhido === true && pdfNo.height === 40);
  await ev(`document.querySelector('${sel(pdfNo.id)} .fluxo-seta-recolher').click()`); await espera(2000);
  ok('A seta abre na altura de antes', (await nos()).find(n => n.id === pdfNo.id).height === 640);
  ok('Aberto, o PDF mostra as 3 páginas', (await ev(`document.querySelectorAll('${sel(pdfNo.id)} .md-pdf-pagina').length`)) === 3);
  const pc = await ev(`(()=>{const r=document.querySelector('${sel(pdfNo.id)} .md-pdf-paginas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(r.height/2,200)}})()`);
  await mouse('mouseMoved', pc.x, pc.y); await c.env('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pc.x, y: pc.y, deltaX: 0, deltaY: 900 }); await espera(500);
  ok('Rolar sobre o PDF rola as páginas', (await ev(`document.querySelector('${sel(pdfNo.id)} .md-pdf-paginas').scrollTop`)) > 0);
  await espera(3500);
  ok('Depois do autosave, o PDF continua na mesma página', (await ev(`document.querySelector('${sel(pdfNo.id)} .md-pdf-paginas').scrollTop`)) > 0);
  await focarFluxo(); await tecla('z', ['ctrl']); await espera(400);
  ok('Desfazer recolhe de novo', (await nos()).find(n => n.id === pdfNo.id).kiroRecolhido === true);
  const csv = 'nome,nota\n' + Array.from({ length: 1000 }, (_, k) => `aluno ${k},${k % 10}`).join('\n');
  const ids = {};
  for (const [nome, tipo, bytes, chave] of [['notas.txt', 'text/plain', Buffer.from('Primeira linha\nSegunda com acento: ação'), 'texto'], ['tabela.csv', 'text/csv', Buffer.from(csv), 'tabela'], ['som.wav', 'audio/wav', WAV, 'audio']]) {
    antesA = await nos(); await colarArquivo(nome, tipo, bytes); ids[chave] = (await novo(antesA))?.id;
    ok(`${nome} entra no Fluxo, aberto`, !!ids[chave]);
  }
  await espera(1500);
  const caixas = await ev(`[...document.querySelectorAll('.fluxo-cartao')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]})`);
  ok('Arquivos colados não ficam empilhados', !caixas.some((p, i) => caixas.some((q, j) => j > i && p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3])));
  ok('O texto aparece no cartão', (await ev(`document.querySelector('${sel(ids.texto)} .fluxo-texto')?.textContent||''`)).includes('ação'));
  const tab = await ev(`(()=>{const t=document.querySelector('${sel(ids.tabela)} .fluxo-tabela');return t&&{linhas:t.querySelectorAll('tr').length,mais:t.querySelector('.fluxo-tabela-mais')?.textContent}})()`);
  ok('CSV de 1000 linhas mostra 200 e avisa o resto', tab?.linhas === 201 && /801/.test(tab.mais || ''), tab);
  ok('Áudio toca no cartão, sem Abrir', await ev(`!!document.querySelector('${sel(ids.audio)} audio') && !document.querySelector('${sel(ids.audio)} .fluxo-abrir')`));
  for (const chave of ['texto', 'tabela']) {
    await ev(`document.querySelector('${sel(ids[chave])} .fluxo-abrir').click()`); await espera(800);
    const abriu = await ev(`!!document.querySelector('.tela-imagem')`);
    await tecla('Escape'); await espera(300);
    ok(`Abrir ${chave} em tela inteira e fechar com Esc`, abriu && await ev(`!document.querySelector('.tela-imagem')`));
  }
  await ev(`(()=>{const a=document.querySelector('${sel(ids.audio)} audio');window.__a=a;a.muted=true;return a.play()})()`); await espera(800);
  const t0 = await ev('window.__a.currentTime');
  const ba = await caixa('a'); await arrastar(ba.x + 30, ba.y + 20, ba.x + 30, ba.y + 60); await espera(3500);
  const depois = await ev(`(()=>{const a=document.querySelector('${sel(ids.audio)} audio');return {mesmo:a===window.__a,tocando:!a.paused,t:a.currentTime}})()`);
  ok('O áudio segue tocando ao mover outro cartão e no autosave', depois.mesmo && depois.tocando && depois.t > t0 + 2, { t0, ...depois });
  antesA = await nos();
  await colarArquivo('falso.txt', 'text/plain', Buffer.from([0x00, 0x01, 0xff, 0x00]));
  ok('Um .txt binário é recusado pelo cofre', (await nos()).length === antesA.length);

  console.log('\n# Mesmo fluxo em duas colunas');
  await abrir('kiro.fv1', ', { colunaNova: true, painel: 1 }'); await espera(1500);
  await ev(`Promise.all([...document.querySelectorAll('${sel(ids.audio)} audio')].map(a=>{a.muted=true;return a.play()}))`); await espera(800);
  const duas0 = await ev(`[...document.querySelectorAll('${sel(ids.audio)} audio')].map(a=>a.currentTime)`);
  await ev('render()'); await espera(1500);
  const duas = await ev(`[...document.querySelectorAll('${sel(ids.audio)} audio')].map(a=>({tocando:!a.paused,t:a.currentTime}))`);
  ok('As duas colunas têm o cartão de áudio', duas0.length === 2 && duas.length === 2, duas0);
  ok('Depois do autosave, as duas colunas seguem tocando', duas.length === 2 && duas.every((x, i) => x.tocando && x.t > duas0[i]), duas);
  ok('Nenhuma coluna fica com o cartão sem corpo', await ev(`[...document.querySelectorAll('${sel(ids.audio)}')].every(e=>e.querySelector('audio'))`));
  await ev(`(()=>{currentView='today';render();})()`); await espera(800);
  ok('Ao sair do Fluxo, nada continua tocando', await ev(`document.querySelectorAll('audio,video,iframe').length===0 && !document.querySelector('#fluxo-guarda')?.children.length`));

  console.log('\n# Internet no Fluxo');
  await abrir('kiro.fv1'); await recomecar();
  const colarLink = async (url, esperar = 6000) => { const antesL = await nos(); await escreverNaArea(url); await tecla('v', ['ctrl'], ['paste']); await espera(esperar); return novo(antesL); };
  const yt0 = await colarLink('https://youtu.be/dQw4w9WgXcQ', 1500);
  ok('Desligada (padrão): o YouTube vira link comum', yt0?.width === 320 && await ev(`!document.querySelector('${sel(yt0.id)} .fluxo-video-miniatura')`));
  const site0 = await colarLink('https://example.com/', 1500);
  ok('Desligada (padrão): o site fica sem prévia', site0 && !site0.kiroPrevia);
  ok('Desligada (padrão): nada sai para o YouTube nem para o site', (await ev(`performance.getEntriesByType('resource').filter(r=>/youtube|ytimg|example\\.com/.test(r.name)).length`)) === 0);
  if (COM_INTERNET) {
    await ligarInternet(true);
    const site = await colarLink('https://example.com/?ligado', 8000);
    ok('Ligada: o site ganha prévia', site?.kiroPrevia?.titulo === 'Example Domain', site?.kiroPrevia);
    const ruim = await colarLink('https://kiro-teste-que-nao-existe.invalid/', 10000);
    ok('Ligada: site que não existe fica só com o endereço', ruim && !ruim.kiroPrevia);
    let yt = await colarLink('https://youtu.be/dQw4w9WgXcQ', 2000);
    ok('Ligada: YouTube nasce 480×300, com miniatura', yt?.width === 480 && yt.height === 300 && await ev(`!!document.querySelector('${sel(yt.id)} .fluxo-video-miniatura')`));
    for (let k = 0; k < 20 && !yt?.kiroPrevia?.titulo; k++) { await espera(500); yt = (await nos()).find(n => n.id === yt.id); }
    ok('Ligada: o YouTube ganha o título', !!yt?.kiroPrevia?.titulo, yt?.kiroPrevia);
    await ev(`document.querySelector('${sel(yt.id)} .fluxo-video-tocar').click()`); await espera(1500);
    ok('Tocar põe o player no cartão', await ev(`!!document.querySelector('${sel(yt.id)} iframe[src*="youtube-nocookie.com/embed/"]')`));
    await ev(`document.querySelector('${sel(yt.id)} .fluxo-abrir').click()`); await espera(1000);
    ok('Abrir leva o vídeo para a tela inteira e o cartão para de tocar', await ev(`!!document.querySelector('.tela-imagem iframe') && !document.querySelector('${sel(yt.id)} iframe')`));
    await tecla('Escape'); await espera(300);
    await ligarInternet(false);
  } else console.log('(pulado: prévia e YouTube; rode com -- --internet)');

  ok('Nenhum erro no console', erros.length === 0, erros.slice(0, 5));
  await ev(`(async()=>{for(const k of ['kiro.fv1','kiro.fv2']){const id=localStorage.getItem(k);state.fluxos=state.fluxos.filter(f=>f.id!==id);localStorage.removeItem(k);}await save();})()`).catch(() => {});
  const passaram = resultados.filter(Boolean).length;
  console.log(`\n${passaram} de ${resultados.length} ok`);
  codigo = passaram === resultados.length ? 0 : 1;
} catch (erro) {
  console.error('Parou no meio:', erro.message);
} finally {
  c?.fechar();
  app.kill();
  await espera(1000);
  fs.rmSync(PERFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  process.exit(codigo);
}
