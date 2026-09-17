'use strict';
// Ligação do kiro.fetch e das chaves dos plug-ins (etapa 3), usada igual pelo
// processo principal do Electron e pelo servidor local. A página nunca é
// confiável: tudo o que ela diz sobre permissão é relido aqui, do cofre.
// O valor de uma chave só existe dentro de cabecalhoDoSegredo, a caminho do
// executor; não volta em retorno, erro, log nem auditoria.
const P = require('./plugins.js');
const { executarPedido } = require('./rede-plugins.cjs');
const { AuditLog } = require('./agent/audit.cjs');

// status: o código HTTP que o servidor usa; no Electron só a mensagem importa.
const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status });
const lista = v => Array.isArray(v) ? v : [];

// Manifesto válido de um plug-in que existe na pasta (ativo ou não).
async function manifestoDoPlugin(vault, pluginId, versaoDoKiro) {
  if (typeof pluginId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(pluginId)) throw erro(403, 'Plug-in inválido.');
  const achado = (await vault.listPlugins()).find(a => a.id === pluginId);
  if (!achado || achado.erro) throw erro(403, `Plug-in não encontrado: ${pluginId}.`);
  const r = P.validarManifesto(achado.manifesto, { versaoDoKiro });
  if (!r.ok || r.manifesto.id !== pluginId) throw erro(403, `O manifesto do plug-in ${pluginId} não é válido.`);
  return r.manifesto;
}

async function atenderFetch({ vault, guarda, versaoDoKiro, pluginId, pedido, requisitar, lookup }) {
  const inicio = Date.now();
  let host = null;
  try { host = new URL(String(pedido && pedido.url)).hostname.toLowerCase().slice(0, 253); } catch { /* URL ruim: a validação diz por quê */ }
  const method = pedido && typeof pedido.method === 'string' ? pedido.method.toUpperCase().slice(0, 10) : 'GET';
  const auditar = extra => new AuditLog(vault.directory).record({
    client: 'plugin', clientName: String(pluginId).slice(0, 40), action: 'network.fetch', target: host, method, durationMs: Date.now() - inicio, ...extra,
  }).catch(() => {});
  try {
    const [achados, escolhas] = await Promise.all([vault.listPlugins(), vault.readPluginChoices()]);
    // planoDeCarga confere manifesto válido, id da pasta, enabled e consentimento em dia.
    const alvo = P.planoDeCarga(achados, escolhas, { versaoDoKiro }).carregar.find(a => a.id === pluginId);
    if (!alvo) throw erro(403, `O plug-in ${pluginId} não está ativo.`);
    const registro = escolhas[pluginId];
    if (!P.podeChamar(registro.permissions, 'fetch')) throw erro(403, 'O plug-in não tem a permissão network.');
    // Vale o concedido que o manifesto ainda declara.
    const hostsConcedidos = lista(registro.network).filter(h => alvo.manifesto.network.includes(h));
    const validado = P.validarPedidoDeRede(pedido, { hostsConcedidos, segredos: alvo.manifesto.secrets });
    if (!validado.ok) throw erro(400, validado.erro);
    const segredo = validado.pedido.secret ? alvo.manifesto.secrets.find(s => s.name === validado.pedido.secret) : null;
    const resultado = await executarPedido(validado.pedido, {
      hostsConcedidos, requisitar, lookup,
      hostDoSegredo: segredo ? segredo.host : undefined,
      // Só o host do segredo recebe o cabeçalho, montado com header e format do manifesto.
      cabecalhoDoSegredo: segredo ? async hostDoSalto => {
        if (hostDoSalto !== segredo.host) return null;
        const valor = await guarda.valor(vault.directory, pluginId, segredo.name);
        // split/join, não replace: "$&" no valor não pode virar padrão de substituição.
        return valor === null ? null : { nome: segredo.header, valor: segredo.format.split('{value}').join(valor) };
      } : undefined,
    }).catch(e => { throw erro(502, e.message); });
    await auditar({ status: 'success', httpStatus: resultado.status, bytes: resultado.bytes });
    return { status: resultado.status, headers: resultado.headers, text: resultado.text, bytes: resultado.bytes };
  } catch (e) {
    await auditar({ status: 'error', error: String(e.message).slice(0, 300) });
    throw e;
  }
}

// Chaves: só nomes declarados no manifesto; nenhuma função devolve valor.
async function nomeDeclarado(vault, pluginId, nome, versaoDoKiro) {
  const manifesto = await manifestoDoPlugin(vault, pluginId, versaoDoKiro);
  if (!manifesto.secrets.some(s => s.name === nome)) throw erro(400, `O plug-in não declara a chave ${String(nome).slice(0, 40)}.`);
}
const estadoDasChaves = async ({ vault, guarda, versaoDoKiro, pluginId }) => {
  await manifestoDoPlugin(vault, pluginId, versaoDoKiro);
  return guarda.estado(vault.directory, pluginId);
};
async function gravarChave({ vault, guarda, versaoDoKiro, pluginId, nome, valor }) {
  await nomeDeclarado(vault, pluginId, nome, versaoDoKiro);
  await guarda.definir(vault.directory, pluginId, nome, valor);
  return guarda.estado(vault.directory, pluginId);
}
async function removerChave({ vault, guarda, versaoDoKiro, pluginId, nome }) {
  await nomeDeclarado(vault, pluginId, nome, versaoDoKiro);
  await guarda.remover(vault.directory, pluginId, nome);
  return guarda.estado(vault.directory, pluginId);
}

module.exports = { atenderFetch, estadoDasChaves, gravarChave, removerChave };
