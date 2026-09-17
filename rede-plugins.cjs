'use strict';
// Executor de rede dos plug-ins (etapa 3). Roda só no processo principal do
// Electron ou no servidor local. Recebe um pedido já validado por
// validarPedidoDeRede (plugins.js) e revalida aqui tudo o que depende da rede:
// destino de cada salto, endereço resolvido na hora da conexão, tempo e tamanho.
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

const LIMITES = { tempo: 10000, resposta: 5 * 1024 * 1024, redirecionamentos: 3 };
const CABECALHOS_DE_RESPOSTA = ['content-type', 'content-length', 'etag', 'last-modified', 'cache-control', 'retry-after'];
const REDIRECIONAMENTOS = new Set([301, 302, 303, 307, 308]);

// Faixas proibidas. O BlockList do Node também confere IPv4 mapeado em IPv6
// (::ffff:a.b.c.d, em qualquer grafia) contra as regras de IPv4.
const bloqueio = new net.BlockList();
for (const [rede, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) bloqueio.addSubnet(rede, bits, 'ipv4');
for (const [rede, bits] of [
  ['::', 96],          // não especificado, loopback e IPv4 compatível (obsoleto)
  ['64:ff9b::', 96],   // NAT64 (embute IPv4)
  ['64:ff9b:1::', 48], // NAT64 local
  ['100::', 64],       // descarte
  ['2001::', 32],      // Teredo (embute IPv4)
  ['2001:db8::', 32],  // documentação
  ['2002::', 16],      // 6to4 (embute IPv4)
  ['fc00::', 7],       // rede privada (ULA)
  ['fe80::', 9],       // link-local e site-local (fec0::/10, obsoleto)
  ['ff00::', 8],       // multicast
]) bloqueio.addSubnet(rede, bits, 'ipv6');

function enderecoProibido(ip) {
  if (typeof ip !== 'string') return true;
  const endereco = ip.split('%')[0]; // tira o índice de zona (fe80::1%eth0)
  const tipo = net.isIP(endereco);
  if (!tipo) return true;
  try { return bloqueio.check(endereco, tipo === 4 ? 'ipv4' : 'ipv6'); } catch { return true; }
}

// Erro nosso: mensagem pensada para o plug-in, sem cabeçalho nem segredo.
const erroProprio = mensagem => Object.assign(new Error(mensagem), { kiro: true });

// Embrulha o lookup usado pela PRÓPRIA conexão: o endereço conferido é o mesmo
// com que o socket conecta, sem janela entre checagem e conexão.
function lookupProtegido(base) {
  return (host, opcoes, cb) => {
    if (typeof opcoes === 'function') { cb = opcoes; opcoes = {}; }
    const o = typeof opcoes === 'number' ? { family: opcoes } : { ...opcoes };
    base(host, { ...o, all: true }, (erro, enderecos) => {
      if (erro) return cb(erro);
      const lista = Array.isArray(enderecos) ? enderecos : [];
      if (!lista.length) return cb(erroProprio(`Nenhum endereço encontrado para ${host}.`));
      if (lista.some(e => enderecoProibido(e && e.address))) return cb(erroProprio('O host aponta para a rede local; conexão recusada.'));
      if (o.all) return cb(null, lista);
      cb(null, lista[0].address, lista[0].family);
    });
  };
}

// Devolve a URL conferida ou lança com o motivo.
function conferirDestino(endereco, hostsConcedidos, prefixo) {
  const recusa = motivo => { throw erroProprio(prefixo + motivo); };
  let url;
  try { url = new URL(endereco); } catch { recusa('endereço (URL) inválido.'); }
  if (url.protocol !== 'https:') recusa('só endereços https são permitidos.');
  if (url.port && url.port !== '443') recusa('só a porta 443 é permitida.');
  if (url.username || url.password) recusa('URL com usuário ou senha não é permitida.');
  const host = url.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) recusa('use o nome do host, não um endereço IP.');
  if (!hostsConcedidos.includes(host)) recusa(`host não liberado: ${host}.`);
  return url;
}

function lerCorpo(resposta, limite) {
  return new Promise((resolve, reject) => {
    const excedeu = () => { resposta.destroy(); reject(erroProprio(`A resposta passou do limite de tamanho (${limite} bytes).`)); };
    if (Number(resposta.headers['content-length']) > limite) return excedeu();
    const partes = [];
    let total = 0;
    resposta.on('data', parte => {
      total += parte.length;
      if (total > limite) return excedeu();
      partes.push(parte);
    });
    resposta.on('end', () => resolve(Buffer.concat(partes)));
    resposta.on('error', reject);
  });
}

async function executarPedido(pedido, { hostsConcedidos = [], cabecalhoDoSegredo, hostDoSegredo, lookup = dns.lookup, requisitar = https.request, limites } = {}) {
  const lim = { ...LIMITES, ...limites };
  const concedidos = hostsConcedidos.map(h => String(h).toLowerCase());
  const lookupSeguro = lookupProtegido(lookup);
  let atual = { req: null, resposta: null, host: pedido.host };
  let acabou = false;

  const cadeia = async () => {
    let url = conferirDestino(String(pedido.url), concedidos, 'Pedido recusado: ');
    const hostSegredo = hostDoSegredo || url.hostname;
    let segredo = null;
    if (pedido.secret) {
      segredo = typeof cabecalhoDoSegredo === 'function' ? await cabecalhoDoSegredo(hostSegredo) : null;
      if (!segredo) throw erroProprio(`A chave ${pedido.secret} não está configurada.`);
      if (!/^[A-Za-z0-9-]{1,64}$/.test(String(segredo.nome)) || /[\r\n\0]/.test(String(segredo.valor))) throw erroProprio(`A chave ${pedido.secret} tem caracteres inválidos.`);
    }
    let method = pedido.method || 'GET';
    let body = pedido.body ?? null;
    for (let saltos = 0; ; saltos++) {
      if (acabou) return; // o tempo estourou enquanto esperava: não abre outra conexão
      const host = url.hostname;
      const headers = { ...pedido.headers, 'user-agent': 'Kiro-Plugins' };
      if (body === null) delete headers['content-type'];
      else headers['content-length'] = String(Buffer.byteLength(body));
      if (segredo && host === hostSegredo) headers[segredo.nome.toLowerCase()] = String(segredo.valor);

      atual = { req: null, resposta: null, host };
      const resposta = await new Promise((resolve, reject) => {
        const req = requisitar({ protocol: 'https:', hostname: host, servername: host, port: 443, path: url.pathname + url.search, method, headers, lookup: lookupSeguro, agent: false, rejectUnauthorized: true }, resolve);
        atual.req = req;
        req.on('error', reject);
        body === null ? req.end() : req.end(body);
      });
      atual.resposta = resposta;

      const location = resposta.headers.location;
      if (!REDIRECIONAMENTOS.has(resposta.statusCode) || !location) {
        const buffer = await lerCorpo(resposta, lim.resposta);
        const devolvidos = {};
        for (const nome of CABECALHOS_DE_RESPOSTA) if (typeof resposta.headers[nome] === 'string') devolvidos[nome] = resposta.headers[nome];
        return { status: resposta.statusCode, headers: devolvidos, text: buffer.toString('utf8'), bytes: buffer.length, redirecionamentos: saltos };
      }
      resposta.destroy();
      if (saltos + 1 > lim.redirecionamentos) throw erroProprio(`Muitos redirecionamentos (limite de ${lim.redirecionamentos}).`);
      let proxima;
      try { proxima = new URL(String(location), url).href; } catch { throw erroProprio('Redirecionamento recusado: endereço (URL) inválido.'); }
      url = conferirDestino(proxima, concedidos, 'Redirecionamento recusado: ');
      if (resposta.statusCode === 303 || ((resposta.statusCode === 301 || resposta.statusCode === 302) && method === 'POST')) {
        method = 'GET';
        body = null;
      }
    }
  };

  return new Promise((resolve, reject) => {
    const fim = (erro, valor) => {
      if (acabou) return;
      acabou = true;
      clearTimeout(relogio);
      if (!erro) return resolve(valor);
      if (atual.resposta) atual.resposta.destroy();
      if (atual.req) atual.req.destroy();
      // Erro de fora (TLS, socket, transporte) vira mensagem genérica: nunca
      // repassa texto que possa carregar cabeçalho ou segredo.
      reject(erro && erro.kiro ? erro : erroProprio(`Falha na conexão com ${atual.host}: ${(erro && typeof erro.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(erro.code)) ? erro.code : 'erro de rede'}.`));
    };
    const relogio = setTimeout(() => fim(erroProprio(`O pedido passou do limite de tempo (${lim.tempo / 1000} s).`)), lim.tempo);
    cadeia().then(valor => fim(null, valor), erro => fim(erro));
  });
}

module.exports = { enderecoProibido, executarPedido };
