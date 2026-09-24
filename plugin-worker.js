// Worker de plug-in (código do Kiro, não do plug-in): importa o index.js de
// terceiro, monta o objeto `kiro` conforme as permissões concedidas e conversa
// com a página só por mensagem. Sem DOM, sem disco e sem rede — a rede é cortada
// pela CSP da resposta que serve o arquivo do plug-in.
//
// É um worker de MÓDULO: `new Worker('plugin-worker.js', { type: 'module' })`.
// Worker clássico não serve, porque `import()` dinâmico só existe em módulo.
//
// Protocolo (página → worker):
//   { tipo: 'ativar', id, url, permissoes }
//   { tipo: 'resposta', chamada, valor | erro }   resposta a uma 'chamada' do worker
//   { tipo: 'acao', chamada, registro: { tipo, id }, dados }
// (worker → página):
//   { tipo: 'pronto', registros: { command: [{ id, label }], panel: [{ id, label, options?, width? }], event: ['save'|'create'|'day'], block: ['render'] } }
// Eventos chegam como 'acao' com registro { tipo: 'event', id: 'save'|'create'|'day' }
// e dados { note } (save/create) ou { date } (day).
// Blocos ```kiro:<id> chegam como 'acao' com registro { tipo: 'block', id: 'render' }
// e dados { source }; o handler devolve { html } ou dados de painel.
//   { tipo: 'chamada', chamada, metodo, args }    pedido de método da API
//   kiro.fetch, só com network concedida, vira metodo 'fetch', args [url, { method, headers, body, secret }],
//   e volta { status, headers, text }. Quem chama a rede é o Electron ou o servidor, nunca o worker.
//   { tipo: 'resposta', chamada, valor | erro }   retorno de uma 'acao'
//   { tipo: 'erro', mensagem }
import './plugins.js';

const { metodosPermitidos } = globalThis.KiroPlugins;
const pendentes = new Map();
const registros = { command: new Map(), panel: new Map(), event: new Map(), block: new Map() };
let proxima = 1;
let ativado = false;

// Todo método da API é um pedido à página: aqui não se toca em nada de verdade.
function chamar(metodo, args) {
  const chamada = proxima++;
  return new Promise((resolve, reject) => {
    pendentes.set(chamada, { resolve, reject });
    try {
      postMessage({ tipo: 'chamada', chamada, metodo, args });
    } catch (erro) {
      pendentes.delete(chamada);
      reject(new Error(`Não foi possível enviar ${metodo}: ${erro.message}`));
    }
  });
}

function guardar(tipo, id, label, handler, extra) {
  if (typeof id !== 'string' || !id) throw new Error('O id do registro é obrigatório.');
  if (typeof handler !== 'function') throw new Error('O handler precisa ser uma função.');
  registros[tipo].set(id, { label: String(label || id), handler, extra });
}

// Só os métodos liberados pelas permissões entram no objeto: primeira barreira.
// A segunda é o hospedeiro, que confere de novo a cada chamada.
function montarApi(permissoes) {
  const kiro = {
    command: (id, label, handler) => guardar('command', id, label, handler),
    // O 4º argumento ({ options, width }) é só dado: quem valida e desenha é a página.
    panel: (id, label, render, extra) => {
      let dados;
      try { dados = extra === undefined ? undefined : JSON.parse(JSON.stringify({ options: extra.options, width: extra.width })); }
      catch { throw new Error('As opções do painel precisam ser dados simples (sem funções).'); }
      guardar('panel', id, label, render, dados);
    },
    // Um handler por evento; registrar de novo troca o anterior.
    onSave: handler => guardar('event', 'save', 'save', handler),
    onCreate: handler => guardar('event', 'create', 'create', handler),
    onDay: handler => guardar('event', 'day', 'day', handler),
    // Um desenhista por plug-in: recebe o texto do bloco (string), devolve { html } ou painel.
    block: handler => guardar('block', 'render', 'render', ({ source } = {}) => handler(String(source ?? ''))),
  };
  for (const metodo of metodosPermitidos(permissoes)) {
    const [grupo, nome] = metodo.includes('.') ? metodo.split('.') : ['', metodo];
    const fn = (...args) => chamar(metodo, args);
    if (!grupo) kiro[nome] = fn;
    else (kiro[grupo] = kiro[grupo] || {})[nome] = fn;
  }
  return kiro;
}

const listar = tipo => [...registros[tipo]].map(([id, { label, extra }]) => ({ id, label, ...extra }));

async function ativar({ url, permissoes }) {
  if (ativado) throw new Error('O plug-in já foi ativado.');
  ativado = true;
  const modulo = await import(url);
  const plugin = modulo.default || modulo;
  if (!plugin || typeof plugin.activate !== 'function') throw new Error('O plug-in precisa exportar activate(kiro).');
  await plugin.activate(montarApi(permissoes));
  postMessage({ tipo: 'pronto', registros: { command: listar('command'), panel: listar('panel'), event: [...registros.event.keys()], block: [...registros.block.keys()] } });
}

// Um clique num painel ou um comando: a página pede, o plug-in responde.
async function agir({ chamada, registro, dados }) {
  try {
    const alvo = registros[registro && registro.tipo];
    const item = alvo && alvo.get(registro.id);
    if (!item) throw new Error(`O plug-in não registrou ${registro && registro.tipo} ${registro && registro.id}.`);
    postMessage({ tipo: 'resposta', chamada, valor: await item.handler(dados) });
  } catch (erro) {
    postMessage({ tipo: 'resposta', chamada, erro: String((erro && erro.message) || erro) });
  }
}

onmessage = async ({ data }) => {
  const mensagem = data || {};
  try {
    if (mensagem.tipo === 'ativar') await ativar(mensagem);
    else if (mensagem.tipo === 'acao') await agir(mensagem);
    else if (mensagem.tipo === 'resposta') {
      const pendente = pendentes.get(mensagem.chamada);
      if (!pendente) return;
      pendentes.delete(mensagem.chamada);
      if (mensagem.erro) pendente.reject(new Error(mensagem.erro));
      else pendente.resolve(mensagem.valor);
    }
  } catch (erro) {
    postMessage({ tipo: 'erro', mensagem: String((erro && erro.message) || erro) });
  }
};
