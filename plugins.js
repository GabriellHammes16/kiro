// plugins.js — parte pura do sistema de plug-ins: validação do manifesto,
// comparação de permissões e consentimento. Roda no navegador e no Node, como o
// domain.js. A API pública dos plug-ins é em inglês; o resto segue em português.
(function (root) {
  const PERMISSOES = ['notes:read', 'notes:write', 'tasks:read', 'tasks:write', 'habits:read', 'habits:write', 'folders:write', 'network'];
  const ROTULOS = {
    'notes:read': 'ler suas notas', 'notes:write': 'criar e alterar notas',
    'tasks:read': 'ver suas tarefas', 'tasks:write': 'criar e alterar tarefas',
    'habits:read': 'ver seus hábitos', 'habits:write': 'criar e alterar hábitos',
    'folders:write': 'criar e renomear pastas', network: 'acessar a internet',
  };
  const texto = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const versao = v => typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
  const partes = v => v.split('.').map(Number);
  // Compara versões no formato maior.menor.correcao: -1, 0 ou 1.
  function compararVersoes(a, b) {
    const [x, y] = [partes(a), partes(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  const lista = v => Array.isArray(v) ? v : [];
  // Host exato, sem curinga, sem esquema e sem caminho: "api.exemplo.com".
  const hostValido = v => typeof v === 'string' && /^[a-z0-9.-]{3,253}$/i.test(v) && v.includes('.');

  function validarManifesto(bruto, { versaoDoKiro } = {}) {
    const recusa = erro => ({ ok: false, erro });
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return recusa('O manifesto precisa ser um objeto JSON.');
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(bruto.id || '')) return recusa('O campo id deve ter de 2 a 40 caracteres, em minúsculas, números e hífen.');
    for (const campo of ['name', 'author']) if (!texto(bruto[campo], 200)) return recusa(`O campo ${campo} é obrigatório e vai até 200 caracteres.`);
    if (bruto.description !== undefined && !texto(bruto.description, 200)) return recusa('A descrição vai até 200 caracteres.');
    if (!versao(bruto.version)) return recusa('A versão deve ser no formato 1.0.0.');
    if (!versao(bruto.minKiro)) return recusa('O campo minKiro deve ser no formato 1.0.0.');
    if (versaoDoKiro && compararVersoes(bruto.minKiro, versaoDoKiro) > 0) return recusa(`Este plug-in precisa do Kiro ${bruto.minKiro} ou mais novo.`);
    if (bruto.permissions !== undefined && !Array.isArray(bruto.permissions)) return recusa('O campo permissions deve ser uma lista de permissões.');
    if (bruto.network !== undefined && !Array.isArray(bruto.network)) return recusa('O campo network deve ser uma lista de endereços.');
    const permissions = lista(bruto.permissions);
    const estranha = permissions.find(p => !PERMISSOES.includes(p));
    if (estranha !== undefined) return recusa(`Permissão desconhecida: ${estranha}.`);
    const network = lista(bruto.network);
    // O esquema vem antes do formato: quem escreveu "http://exemplo.com" merece o aviso do https.
    if (network.some(h => typeof h === 'string' && /^[a-z]+:\/\//i.test(h))) return recusa('Em network, use só o host, sem https:// na frente.');
    const ruim = network.find(h => !hostValido(h));
    if (ruim !== undefined) return recusa(`Endereço de rede inválido: ${ruim}. Use o host exato, como api.exemplo.com.`);
    if (network.length && !permissions.includes('network')) return recusa('Para usar rede, declare a permissão network.');
    return { ok: true, manifesto: { id: bruto.id, name: bruto.name, author: bruto.author, description: bruto.description || '', version: bruto.version, minKiro: bruto.minKiro, permissions, network } };
  }

  const comparar = (concedidas, pedidas) => ({
    novas: lista(pedidas).filter(p => !lista(concedidas).includes(p)),
    removidas: lista(concedidas).filter(p => !lista(pedidas).includes(p)),
  });
  // Só pergunta de novo quando o plug-in passou a pedir mais do que já tinha.
  const precisaConsentir = (registro, manifesto) =>
    comparar(registro && registro.permissions, manifesto.permissions).novas.length > 0 ||
    comparar(registro && registro.network, manifesto.network).novas.length > 0;
  const rotuloDaPermissao = nome => ROTULOS[nome] || nome;

  // Cada método da API pede uma permissão; storage e interface não pedem nada.
  // Esta lista é a fronteira: o que não está aqui o plug-in nunca alcança.
  const METODOS = {
    'notes.list': 'notes:read', 'notes.get': 'notes:read', 'notes.current': 'notes:read', 'notes.search': 'notes:read',
    'notes.create': 'notes:write', 'notes.update': 'notes:write', 'notes.trash': 'notes:write', 'notes.move': 'notes:write',
    'tasks.list': 'tasks:read', 'tasks.create': 'tasks:write', 'tasks.update': 'tasks:write',
    'habits.list': 'habits:read', 'habits.mark': 'habits:write',
    'folders.create': 'folders:write',
    'storage.get': '', 'storage.set': '', 'notify': '',
  };
  const tem = (objeto, chave) => Object.prototype.hasOwnProperty.call(objeto, chave);
  const metodosPermitidos = permissoes => Object.keys(METODOS).filter(m => !METODOS[m] || lista(permissoes).includes(METODOS[m]));
  const podeChamar = (permissoes, metodo) => tem(METODOS, metodo) && (!METODOS[metodo] || lista(permissoes).includes(METODOS[metodo]));

  const api = { PERMISSOES, METODOS, validarManifesto, compararVersoes, comparar, precisaConsentir, rotuloDaPermissao, metodosPermitidos, podeChamar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroPlugins = api;
})(globalThis);
