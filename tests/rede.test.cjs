const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { Readable } = require('node:stream');
const R = require('../rede-plugins.cjs');

test('endereços da rede local e reservados são proibidos', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'fc00::1', 'fd12::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:192.168.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1'])
    assert.equal(R.enderecoProibido(ip), true, ip);
  for (const ip of ['', 'abc', '999.1.1.1', '1.2.3', null, undefined, 42, '::ffff:999.0.0.1'])
    assert.equal(R.enderecoProibido(ip), true, `inválido: ${ip}`);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
    assert.equal(R.enderecoProibido(ip), false, ip);
});

// Transporte falso com a assinatura de https.request(opcoes, aoResponder).
// Chama opcoes.lookup como a conexão faria, para provar que a checagem roda nela.
function transporte(roteiro, { formaDoLookup = { all: true } } = {}) {
  const vistos = [];
  const requisicoes = [];
  const requisitar = (opcoes, aoResponder) => {
    const req = new EventEmitter();
    req.destruida = false;
    requisicoes.push(req);
    req.destroy = erro => { req.destruida = true; if (erro) req.emit('error', erro); return req; };
    req.end = corpo => {
      vistos.push({ ...opcoes, headers: { ...opcoes.headers }, corpo });
      opcoes.lookup(opcoes.hostname, formaDoLookup, (erro, endereco) => {
        if (erro) return req.emit('error', erro);
        req.endereco = endereco;
        const passo = roteiro.shift();
        if (passo.erro) return req.emit('error', passo.erro);
        if (passo.nunca) return;
        const responder = () => {
          if (req.destruida) return;
          const resposta = Readable.from(passo.chunks || [Buffer.from(passo.text || '')]);
          resposta.statusCode = passo.status;
          resposta.headers = passo.headers || {};
          aoResponder(resposta);
        };
        passo.atraso ? setTimeout(responder, passo.atraso) : responder();
      });
    };
    return req;
  };
  return { requisitar, vistos, requisicoes };
}
const lookupPublico = (host, opcoes, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
const pedido = extra => ({ url: 'https://api.deepl.com/v2/x', host: 'api.deepl.com', method: 'GET', headers: {}, body: null, secret: null, ...extra });
const hostsConcedidos = ['api.deepl.com'];
const rodar = (t, extra = {}, p = pedido()) => R.executarPedido(p, { hostsConcedidos, lookup: lookupPublico, requisitar: t.requisitar, ...extra });

test('pedido simples devolve status, texto e só cabeçalhos permitidos', async () => {
  const t = transporte([{ status: 200, text: 'olá', headers: { 'content-type': 'text/plain', 'set-cookie': ['a=b'], 'x-secreto': '1', etag: '"1"' } }]);
  const r = await rodar(t);
  assert.deepEqual(r, { status: 200, headers: { 'content-type': 'text/plain', etag: '"1"' }, text: 'olá', bytes: 4, redirecionamentos: 0 });
  const o = t.vistos[0];
  assert.equal(o.hostname, 'api.deepl.com');
  assert.equal(o.port, 443);
  assert.equal(o.path, '/v2/x');
  assert.equal(o.rejectUnauthorized, true);
  assert.equal(o.headers['user-agent'], 'Kiro-Plugins');
  assert.equal(o.headers.cookie, undefined);
  assert.deepEqual(t.requisicoes[0].endereco, [{ address: '93.184.216.34', family: 4 }]);
});

test('pedido inicial é revalidado: https, porta, host concedido, IP literal', async () => {
  const t = transporte([]);
  await assert.rejects(rodar(t, {}, pedido({ url: 'http://api.deepl.com/' })), /https/);
  await assert.rejects(rodar(t, {}, pedido({ url: 'https://api.deepl.com:8443/' })), /porta/);
  await assert.rejects(rodar(t, {}, pedido({ url: 'https://evil.com/' })), /não liberado/);
  await assert.rejects(rodar(t, {}, pedido({ url: 'https://u:p@api.deepl.com/' })), /usuário/);
  await assert.rejects(rodar(t, { hostsConcedidos: ['127.0.0.1'] }, pedido({ url: 'https://127.0.0.1/' })), /IP/);
  await assert.rejects(rodar(t, { hostsConcedidos: ['[::1]', '::1'] }, pedido({ url: 'https://[::1]/' })), /IP/);
  assert.equal(t.vistos.length, 0);
});

test('host que resolve para a rede local é recusado na conexão', async () => {
  const local = (host, opcoes, cb) => cb(null, [{ address: '192.168.0.10', family: 4 }]);
  await assert.rejects(rodar(transporte([{ status: 200 }]), { lookup: local }), /rede local/);
  // Um endereço público e um privado juntos: recusa.
  const misto = (host, opcoes, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:10.0.0.1', family: 6 }]);
  await assert.rejects(rodar(transporte([{ status: 200 }]), { lookup: misto }), /rede local/);
  const vazio = (host, opcoes, cb) => cb(null, []);
  await assert.rejects(rodar(transporte([{ status: 200 }]), { lookup: vazio }), /endereço/);
  const invalido = (host, opcoes, cb) => cb(null, [{ address: 'nao-e-ip', family: 4 }]);
  await assert.rejects(rodar(transporte([{ status: 200 }]), { lookup: invalido }), /rede local/);
});

test('lookup embrulhado atende as duas formas que a conexão usa', async () => {
  const pedidos = [];
  const base = (host, opcoes, cb) => { pedidos.push(opcoes); cb(null, [{ address: '2606:4700::1', family: 6 }]); };
  const semAll = transporte([{ status: 200 }], { formaDoLookup: { family: 0 } });
  await rodar(semAll, { lookup: base });
  assert.equal(semAll.requisicoes[0].endereco, '2606:4700::1');
  const comAll = transporte([{ status: 200 }], { formaDoLookup: { all: true } });
  await rodar(comAll, { lookup: base });
  assert.deepEqual(comAll.requisicoes[0].endereco, [{ address: '2606:4700::1', family: 6 }]);
  assert.ok(pedidos.every(o => o.all === true), 'a base sempre é consultada com all: true');
});

test('https.request de verdade usa o lookup protegido (sem sair da máquina)', async () => {
  const local = (host, opcoes, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(R.executarPedido(pedido({ url: 'https://interno.exemplo/', host: 'interno.exemplo' }), { hostsConcedidos: ['interno.exemplo'], lookup: local }), /rede local/);
  const falhaDeDns = (host, opcoes, cb) => cb(Object.assign(new Error('getaddrinfo ENOTFOUND interno.exemplo'), { code: 'ENOTFOUND' }));
  await assert.rejects(R.executarPedido(pedido({ url: 'https://interno.exemplo/', host: 'interno.exemplo' }), { hostsConcedidos: ['interno.exemplo'], lookup: falhaDeDns }), /interno\.exemplo.*ENOTFOUND/);
});

test('redirecionamento só para host concedido, até o limite', async () => {
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: 'https://evil.com/' } }])), /redirecion.*não liberado/i);

  const dentro = transporte([{ status: 301, headers: { location: '/v2/y?a=1' } }, { status: 200, text: 'fim' }]);
  const r = await rodar(dentro);
  assert.equal(r.text, 'fim');
  assert.equal(r.redirecionamentos, 1);
  assert.equal(dentro.vistos[1].path, '/v2/y?a=1');

  const tres = transporte([...Array.from({ length: 3 }, () => ({ status: 302, headers: { location: '/de-novo' } })), { status: 200, text: 'ok' }]);
  assert.equal((await rodar(tres)).redirecionamentos, 3);
  const quatro = transporte(Array.from({ length: 5 }, () => ({ status: 302, headers: { location: '/de-novo' } })));
  await assert.rejects(rodar(quatro), /redirecionamentos/);
  assert.equal(quatro.vistos.length, 4);
});

test('redirecionamento revalida esquema, porta, IP literal e o endereço resolvido', async () => {
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: 'http://api.deepl.com/' } }])), /redirecion.*https/i);
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: 'https://api.deepl.com:8443/' } }])), /redirecion.*porta/i);
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: 'https://127.0.0.1/' } }]), { hostsConcedidos: ['api.deepl.com', '127.0.0.1'] }), /redirecion.*IP/i);
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: 'https://u:p@api.deepl.com/' } }])), /redirecion.*usuário/i);
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: 'https://[::1]/' } }])), /redirecion/i);

  // O segundo salto resolve para a rede local (DNS rebinding): recusado.
  let chamadas = 0;
  const trocaEndereco = (host, opcoes, cb) => cb(null, [{ address: chamadas++ === 0 ? '93.184.216.34' : '10.0.0.1', family: 4 }]);
  await assert.rejects(rodar(transporte([{ status: 302, headers: { location: '/b' } }, { status: 200 }]), { lookup: trocaEndereco }), /rede local/);
  assert.equal(chamadas, 2);
});

test('302 sem location volta como resposta; 303 e POST viram GET; 307 mantém', async () => {
  const sem = await rodar(transporte([{ status: 302, text: 'movido' }]));
  assert.equal(sem.status, 302);
  assert.equal(sem.redirecionamentos, 0);

  const post = pedido({ method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });
  const t303 = transporte([{ status: 303, headers: { location: '/b' } }, { status: 200 }]);
  await rodar(t303, {}, post);
  assert.equal(t303.vistos[0].method, 'POST');
  assert.equal(t303.vistos[0].corpo, '{"a":1}');
  assert.equal(t303.vistos[0].headers['content-length'], '7');
  assert.equal(t303.vistos[1].method, 'GET');
  assert.equal(t303.vistos[1].corpo, undefined);
  assert.equal(t303.vistos[1].headers['content-type'], undefined);
  assert.equal(t303.vistos[1].headers['content-length'], undefined);

  const t307 = transporte([{ status: 307, headers: { location: '/b' } }, { status: 200 }]);
  await rodar(t307, {}, post);
  assert.equal(t307.vistos[1].method, 'POST');
  assert.equal(t307.vistos[1].corpo, '{"a":1}');
});

test('resposta acima do limite é cortada com erro', async () => {
  const limites = { tempo: 10000, resposta: 1024, redirecionamentos: 3 };
  await assert.rejects(rodar(transporte([{ status: 200, chunks: Array.from({ length: 4 }, () => Buffer.alloc(512)) }]), { limites }), /tamanho/);
  // content-length mentiroso (diz pouco, manda muito): a contagem em streaming pega.
  await assert.rejects(rodar(transporte([{ status: 200, headers: { 'content-length': '10' }, text: 'x'.repeat(2048) }]), { limites }), /tamanho/);
  // content-length declarado acima do limite: recusa antes de ler.
  await assert.rejects(rodar(transporte([{ status: 200, headers: { 'content-length': '999999' }, text: 'x' }]), { limites }), /tamanho/);
  // exatamente no limite passa.
  assert.equal((await rodar(transporte([{ status: 200, text: 'x'.repeat(1024) }]), { limites })).bytes, 1024);
});

test('tempo vale para a cadeia inteira e destrói a requisição', async () => {
  const parado = transporte([{ nunca: true }]);
  await assert.rejects(rodar(parado, { limites: { tempo: 50 } }), /tempo/);
  assert.equal(parado.requisicoes[0].destruida, true);

  const lento = transporte([{ status: 302, headers: { location: '/b' }, atraso: 40 }, { status: 200, atraso: 40 }]);
  await assert.rejects(rodar(lento, { limites: { tempo: 60 } }), /tempo/);

  // Tempo estourado enquanto busca a chave: nenhuma conexão é aberta depois.
  const t = transporte([{ status: 200 }]);
  const devagar = () => new Promise(ok => setTimeout(() => ok({ nome: 'authorization', valor: 'x' }), 60));
  await assert.rejects(rodar(t, { limites: { tempo: 20 }, cabecalhoDoSegredo: devagar }, pedido({ secret: 'apiKey' })), /tempo/);
  await new Promise(ok => setTimeout(ok, 80));
  assert.equal(t.vistos.length, 0);
});

test('segredo vira cabeçalho só no host dele e não aparece no resultado', async () => {
  const t = transporte([{ status: 200, text: 'ok' }]);
  const pedidos = [];
  const cabecalhoDoSegredo = async host => { pedidos.push(host); return host === 'api.deepl.com' ? { nome: 'Authorization', valor: 'DeepL-Auth-Key SEGREDO123' } : null; };
  const r = await rodar(t, { cabecalhoDoSegredo }, pedido({ secret: 'apiKey' }));
  assert.equal(t.vistos[0].headers.authorization, 'DeepL-Auth-Key SEGREDO123');
  assert.deepEqual(pedidos, ['api.deepl.com']);
  assert.ok(!JSON.stringify(r).includes('SEGREDO123'));

  // Sem segredo pedido, a função nem é chamada.
  await rodar(transporte([{ status: 200 }]), { cabecalhoDoSegredo: () => assert.fail('não devia buscar o segredo') });
});

test('segredo não segue para outro host num redirecionamento', async () => {
  const t = transporte([{ status: 302, headers: { location: 'https://cdn.deepl.com/a' } }, { status: 200, text: 'ok' }]);
  const cabecalhoDoSegredo = async () => ({ nome: 'authorization', valor: 'SEGREDO123' });
  await rodar(t, { hostsConcedidos: ['api.deepl.com', 'cdn.deepl.com'], cabecalhoDoSegredo }, pedido({ secret: 'apiKey' }));
  assert.equal(t.vistos[0].headers.authorization, 'SEGREDO123');
  assert.equal(t.vistos[1].headers.authorization, undefined);
  assert.ok(!JSON.stringify(t.vistos[1]).includes('SEGREDO123'));
});

test('segredo nunca aparece em erro; chave ausente ou inválida é erro', async () => {
  const cabecalhoDoSegredo = async () => ({ nome: 'authorization', valor: 'SEGREDO123' });
  const vazou = new Error('falhou com authorization: SEGREDO123');
  await assert.rejects(rodar(transporte([{ erro: vazou }]), { cabecalhoDoSegredo }, pedido({ secret: 'apiKey' })), erro => {
    assert.ok(!String(erro.message).includes('SEGREDO123'));
    assert.ok(!String(erro.stack).includes('SEGREDO123'));
    assert.equal(erro.cause, undefined);
    return true;
  });
  await assert.rejects(rodar(transporte([]), { cabecalhoDoSegredo: async () => null }, pedido({ secret: 'apiKey' })), /chave/i);
  await assert.rejects(rodar(transporte([]), {}, pedido({ secret: 'apiKey' })), /chave/i);
  await assert.rejects(rodar(transporte([]), { cabecalhoDoSegredo: async () => ({ nome: 'authorization', valor: 'a\r\nx: y' }) }, pedido({ secret: 'apiKey' })), erro => /chave/i.test(erro.message) && !erro.message.includes('x: y'));
});
