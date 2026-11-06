'use strict';
// Prévia de link do Fluxo (título, descrição e imagem do site), usada igual pelo processo
// principal do Electron e pelo servidor local. Qualquer falha devolve null: o cartão fica
// com o endereço e nada de técnico aparece na tela. A rede passa por executarPedido, que
// recusa endereço privado na conexão e em cada redirecionamento.
const { executarPedido } = require('./rede-plugins.cjs');
const { lerPrevia } = require('./previa-link.js');
const { imageSignature } = require('./vault.cjs');
const { idDoYoutube } = require('./fluxo.js');

// Página: só o começo, o mesmo que lerPrevia lê (as metas ficam no <head>).
const PAGINA = { tempo: 8000, resposta: 512 * 1024 };
const IMAGEM = { tempo: 8000, resposta: 5 * 1024 * 1024 };
const EXTENSAO_DE_IMAGEM = /\.(png|jpe?g|gif|webp)$/i;

// Caminho do anexo no cofre, ou null. O cofre confere a assinatura do arquivo.
async function guardarImagem({ vault, endereco, requisitar, lookup }) {
  try {
    const r = await executarPedido(
      { url: endereco, method: 'GET', headers: { accept: 'image/*' }, body: null },
      { qualquerHost: true, binario: true, agente: 'Kiro', limites: IMAGEM, requisitar, lookup });
    if (r.status !== 200 || !/^image\//i.test(r.headers['content-type'] || '')) return null;
    // Pelo conteúdo, não pelo tipo declarado: só imagem chega ao cofre (um PDF ou um áudio seria aceito por ele).
    if (!['png', 'jpg', 'gif', 'webp'].includes(imageSignature(r.buffer))) return null;
    const nome = new URL(endereco).pathname.split('/').pop() || '';
    const { path } = await vault.saveAttachment({ name: nome, data: r.buffer });
    return EXTENSAO_DE_IMAGEM.test(path) ? path : null;
  } catch { return null; }
}

const OEMBED = { tempo: 8000, resposta: 64 * 1024 };

// YouTube: a página passa de 1 MB e o og:title fica longe do começo; o oEmbed dá o título num JSON pequeno.
async function tituloDoYoutube({ url, requisitar, lookup }) {
  const r = await executarPedido(
    { url: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, method: 'GET', headers: { accept: 'application/json' }, body: null },
    { qualquerHost: true, agente: 'Kiro', limites: OEMBED, requisitar, lookup });
  if (r.status !== 200 || !/^application\/json\b/i.test(r.headers['content-type'] || '')) return null;
  const { title } = JSON.parse(r.text) || {};
  const titulo = typeof title === 'string' ? title.trim().slice(0, 200) : '';
  return titulo ? { titulo, descricao: null, imagem: null } : null;
}

async function buscarPrevia({ vault, url, requisitar, lookup }) {
  try {
    if (idDoYoutube(String(url))) return await tituloDoYoutube({ url: String(url), requisitar, lookup });
    const r = await executarPedido(
      { url: String(url), method: 'GET', headers: { accept: 'text/html' }, body: null },
      { qualquerHost: true, cortar: true, agente: 'Kiro', limites: PAGINA, requisitar, lookup });
    if (r.status !== 200 || !/^text\/html\b/i.test(r.headers['content-type'] || '')) return null;
    // ponytail: a base é o endereço pedido, não o do último redirecionamento; og:image relativa após troca de host erra.
    const previa = lerPrevia(r.text, String(url));
    const imagem = previa.imagem ? await guardarImagem({ vault, endereco: previa.imagem, requisitar, lookup }) : null;
    return previa.titulo || previa.descricao || imagem ? { ...previa, imagem } : null;
  } catch { return null; }
}

module.exports = { buscarPrevia };
