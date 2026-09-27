'use strict';
/**
 * Catálogo de ferramentas e porta de entrada dos agentes.
 *
 * Divisão de responsabilidades: api.cjs faz as operações; aqui ficam as três
 * coisas que só existem por causa de terceiros — validação do schema, permissão
 * e auditoria. A interface do Kiro usa a API direto e não passa por este gate,
 * porque ali quem age é o próprio usuário.
 *
 * Nomes sem prefixo. A camada MCP publica os mesmos com "kiro_" na frente.
 */
const { AgentError } = require('./security.cjs');
const { validate } = require('./schema.cjs');

const PERIODO = {
  since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Só notas criadas ou alteradas a partir deste dia (AAAA-MM-DD, fuso local). Para "ontem", use since e until com a data de ontem. A data de hoje vem em get_daily_note sem argumentos.' },
  until: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Só notas criadas ou alteradas até o fim deste dia (AAAA-MM-DD, fuso local).' },
};
const alvoNota = { id: { type: 'string', description: 'Id da nota. Use este ou "path".' }, path: { type: 'string', description: 'Caminho da nota relativo ao cofre, terminando em .md. Nunca um caminho absoluto.' } };
const alvoFluxo = {
  id: { type: 'string', description: 'Id do fluxo, de list_fluxos. Use este ou "path".' },
  path: { type: 'string', description: 'Caminho do fluxo relativo ao cofre, terminando em .canvas, por exemplo "Estudos/Python.canvas".' },
};

const FERRAMENTAS = [
  {
    name: 'create_note',
    risk: 'write',
    permission: 'create',
    description: 'Cria uma nota Markdown dentro do cofre Kiro atual. O caminho é sempre relativo ao cofre; esta ferramenta não escreve fora dele. Pastas ausentes no caminho informado são criadas. Recusa criar uma segunda nota com o mesmo título na mesma pasta.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título da nota. Vira o nome do arquivo e o alvo de links [[assim]].', maxLength: 200 },
        folder: { type: 'string', description: 'Pasta de destino relativa ao cofre, por exemplo "Projetos/Ideias". Vazio grava na raiz do cofre.' },
        content: { type: 'string', description: 'Corpo da nota em Markdown.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Tags da nota, sem o "#".' },
      },
      required: ['title'],
    },
    run: (api, args, ctx) => api.createNote(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.title,
  },
  {
    name: 'read_note',
    risk: 'read',
    permission: 'read',
    description: 'Lê uma nota do cofre pelo id ou pelo caminho relativo. Devolve título, conteúdo Markdown, pasta, tags e datas.',
    inputSchema: { type: 'object', properties: { ...alvoNota } },
    run: (api, args, ctx) => api.readNote(args, ctx),
    target: (args, resultado) => resultado?.path || args.path || args.id,
  },
  {
    name: 'update_note',
    risk: 'write',
    permission: 'update',
    description: 'Altera uma nota existente. Use mode "append" para acrescentar ao final e "prepend" para inserir no começo, evitando reescrever a nota inteira. Também aceita mudar título, tags e pasta.',
    inputSchema: {
      type: 'object',
      properties: {
        ...alvoNota,
        content: { type: 'string', description: 'Texto Markdown a gravar, acrescentar ou inserir, conforme "mode".' },
        mode: { type: 'string', enum: ['replace', 'append', 'prepend'], default: 'replace', description: 'replace troca o corpo inteiro; append acrescenta ao final; prepend insere no começo.' },
        title: { type: 'string', maxLength: 200, description: 'Novo título. Renomeia o arquivo no cofre.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Substitui a lista de tags da nota.' },
        folder: { type: 'string', description: 'Move a nota para esta pasta, relativa ao cofre.' },
      },
    },
    run: (api, args, ctx) => api.updateNote(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.path || args.id,
  },
  {
    name: 'delete_note',
    risk: 'destructive',
    permission: 'delete',
    description: 'Move uma nota para a lixeira do Kiro. Não apaga em definitivo: devolve um trashEntryId que permite restaurar a nota depois.',
    inputSchema: { type: 'object', properties: { ...alvoNota } },
    run: (api, args, ctx) => api.deleteNote(args, ctx),
    target: (args, resultado) => resultado?.deleted?.path || args.path || args.id,
  },
  {
    name: 'restore_note',
    risk: 'write',
    permission: 'update',
    description: 'Restaura da lixeira um item removido, usando o trashEntryId devolvido por delete_note ou list_trash.',
    inputSchema: { type: 'object', properties: { entryId: { type: 'string', description: 'Identificador do item na lixeira.' } }, required: ['entryId'] },
    run: (api, args, ctx) => api.restoreNote(args, ctx),
    target: args => args.entryId,
  },
  {
    name: 'list_trash',
    risk: 'read',
    permission: 'read',
    description: 'Lista os itens na lixeira do Kiro que ainda podem ser restaurados.',
    inputSchema: { type: 'object', properties: {} },
    run: (api, args, ctx) => api.listTrash(args, ctx),
    target: () => 'trash',
  },
  {
    name: 'list_notes',
    risk: 'read',
    permission: 'read',
    description: 'Lista notas do cofre, da mais recente para a mais antiga. Aceita filtrar por pasta e por período (since/until), e paginar. Use com since/until para perguntas como "o que anotei ontem".',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Restringe a esta pasta, relativa ao cofre.' },
        ...PERIODO,
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    run: (api, args, ctx) => api.listNotes(args, ctx),
    target: args => args.folder || 'vault',
  },
  {
    name: 'search_notes',
    risk: 'read',
    permission: 'read',
    description: 'Busca textual no cofre por título, caminho, tags e conteúdo, sem diferenciar maiúsculas nem acentos. Devolve trechos relevantes de cada nota encontrada. Use antes de read_note quando não souber onde a informação está. Aceita período (since/until) para perguntas como "o que anotei ontem sobre X".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Texto procurado.' },
        ...PERIODO,
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      },
      required: ['query'],
    },
    run: (api, args, ctx) => api.searchNotes(args, ctx),
    target: args => `query:${args.query}`,
  },
  {
    name: 'create_folder',
    risk: 'write',
    permission: 'create',
    description: 'Cria uma pasta no cofre, incluindo pastas intermediárias do caminho. Pastas do Kiro são diretórios reais dentro do cofre.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Caminho relativo ao cofre, por exemplo "Projetos/Ideias".' } }, required: ['path'] },
    run: (api, args, ctx) => api.createFolder(args, ctx),
    target: args => args.path,
  },
  {
    name: 'list_folders',
    risk: 'read',
    permission: 'read',
    description: 'Lista as pastas do cofre com caminho, pasta-mãe e quantidade de notas.',
    inputSchema: { type: 'object', properties: {} },
    run: (api, args, ctx) => api.listFolders(args, ctx),
    target: () => 'vault',
  },
  {
    name: 'move_note',
    risk: 'write',
    permission: 'update',
    description: 'Move uma nota para outra pasta do cofre. O arquivo Markdown é movido de verdade e os links relativos são reescritos pelo Kiro.',
    inputSchema: { type: 'object', properties: { ...alvoNota, folder: { type: 'string', description: 'Pasta de destino relativa ao cofre. Vazio move para a raiz.' } }, required: ['folder'] },
    run: (api, args, ctx) => api.moveNote(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.path || args.id,
  },
  {
    name: 'get_backlinks',
    risk: 'read',
    permission: 'read',
    description: 'Lista as notas que apontam para a nota informada por meio de links [[assim]].',
    inputSchema: { type: 'object', properties: { ...alvoNota } },
    run: (api, args, ctx) => api.getBacklinks(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.path || args.id,
  },
  {
    name: 'get_outgoing_links',
    risk: 'read',
    permission: 'read',
    description: 'Lista os links [[assim]] escritos dentro da nota informada, indicando quais apontam para notas existentes.',
    inputSchema: { type: 'object', properties: { ...alvoNota } },
    run: (api, args, ctx) => api.getOutgoingLinks(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.path || args.id,
  },
  {
    name: 'create_note_link',
    risk: 'write',
    permission: 'update',
    description: 'Acrescenta um link [[assim]] de uma nota para outra. Os backlinks do Kiro são derivados do texto, então basta escrever o link: não existe índice a atualizar à mão.',
    inputSchema: {
      type: 'object',
      properties: {
        fromId: { type: 'string', description: 'Id da nota de origem.' },
        fromPath: { type: 'string', description: 'Caminho da nota de origem, relativo ao cofre.' },
        toId: { type: 'string', description: 'Id da nota de destino.' },
        toPath: { type: 'string', description: 'Caminho da nota de destino, relativo ao cofre.' },
        toTitle: { type: 'string', description: 'Título de destino, mesmo que a nota ainda não exista.' },
        label: { type: 'string', description: 'Rótulo alternativo do link.' },
      },
    },
    run: (api, args, ctx) => api.createNoteLink(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.fromPath || args.fromId,
  },
  {
    name: 'get_recent_notes',
    risk: 'read',
    permission: 'read',
    description: 'Devolve as notas alteradas mais recentemente no cofre.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 10 } } },
    run: (api, args, ctx) => api.getRecentNotes(args, ctx),
    target: () => 'vault',
  },
  {
    name: 'get_daily_note',
    risk: 'read',
    permission: 'read',
    description: 'Devolve a nota diária do Kiro, cujo título é a data local no formato AAAA-MM-DD. Não cria a nota: se não existir, devolve exists:false e o agente pode chamar create_note.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'Data AAAA-MM-DD. Sem isso, usa o dia de hoje.' } } },
    run: (api, args, ctx) => api.getDailyNote(args, ctx),
    target: (args, resultado) => resultado?.date || 'today',
  },
  {
    name: 'get_habits',
    risk: 'read',
    permission: 'read',
    description: 'Devolve os hábitos acompanhados no Kiro com o progresso calculado: frequência, se hoje é dia do hábito e se já foi feito, sequência atual, cumprimento nos últimos 30 dias (%), total de dias feitos e os últimos 7 dias. Use para acompanhar como os hábitos estão indo. Só leitura.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Dia de referência AAAA-MM-DD. Sem isso, usa hoje.' } } },
    run: (api, args, ctx) => api.getHabits(args, ctx),
    target: () => 'habits',
  },
  {
    name: 'add_tag',
    risk: 'write',
    permission: 'update',
    description: 'Acrescenta tags a uma nota, sem apagar as que já existem.',
    inputSchema: { type: 'object', properties: { ...alvoNota, tags: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, required: ['tags'] },
    run: (api, args, ctx) => api.addTag(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.path || args.id,
  },
  {
    name: 'remove_tag',
    risk: 'write',
    permission: 'update',
    description: 'Remove tags dos metadados de uma nota. Tags escritas como #tag no meio do texto continuam valendo e são devolvidas em stillInBody.',
    inputSchema: { type: 'object', properties: { ...alvoNota, tags: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, required: ['tags'] },
    run: (api, args, ctx) => api.removeTag(args, ctx),
    target: (args, resultado) => resultado?.note?.path || args.path || args.id,
  },
  {
    name: 'search_by_tag',
    risk: 'read',
    permission: 'read',
    description: 'Lista as notas que têm as tags informadas, considerando tanto as tags dos metadados quanto as escritas como #tag no texto.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        matchAll: { type: 'boolean', default: false, description: 'true exige todas as tags; false aceita qualquer uma.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['tags'],
    },
    run: (api, args, ctx) => api.searchByTag(args, ctx),
    target: args => (args.tags || []).join(','),
  },
  {
    name: 'list_fluxos',
    risk: 'read',
    permission: 'read',
    description: 'Lista os fluxos do cofre: mapas mentais e canvas de ideias, arquivos .canvas no formato JSON Canvas (compatível com o Obsidian). Devolve id, caminho, título, pasta e quantos cartões e ligações cada um tem. Um fluxo com "error" está com o arquivo corrompido e não pode ser lido nem alterado.',
    inputSchema: { type: 'object', properties: {} },
    run: (api, args, ctx) => api.listFluxos(args, ctx),
    target: () => 'vault',
  },
  {
    name: 'read_fluxo',
    risk: 'read',
    permission: 'read',
    description: 'Lê um fluxo pelo id ou pelo caminho. Devolve os cartões ({ id, type, text | note | url | label | file, color }) e as ligações ({ id, from, to, label }). Em cartões "note", o campo note é o caminho da nota do cofre que o cartão mostra (leia com read_note). Com positions: true, inclui x, y, width e height de cada cartão.',
    inputSchema: {
      type: 'object',
      properties: {
        ...alvoFluxo,
        positions: { type: 'boolean', default: false, description: 'true inclui posição e tamanho dos cartões.' },
      },
    },
    run: (api, args, ctx) => api.readFluxo(args, ctx),
    target: (args, resultado) => resultado?.path || args.path || args.id,
  },
  {
    name: 'create_fluxo',
    risk: 'write',
    permission: 'create',
    description: 'Cria um fluxo (mapa mental ou canvas de ideias, arquivo .canvas compatível com o Obsidian). Você manda a estrutura e o Kiro posiciona: cartões sem x/y viram uma árvore da esquerda para a direita a partir de "root" (ou do primeiro cartão sem ligação chegando). Cada cartão tem um "id" que é um apelido seu; as ligações usam esses apelidos e a resposta traz os ids reais em "ids". Tipos: text (Markdown, com código e fórmulas), note (uma nota do cofre, por caminho ou título), link (URL http/https) e group (moldura com rótulo). Receita para transformar uma nota em mapa mental: leia a nota com read_note; faça um cartão por ideia, com texto curto; o título da nota vira a raiz, cada título (##) vira um ramo ligado à raiz e o que está sob ele vira filhos do ramo; cada bloco de código vira um cartão próprio; passe a nota em sourceNote, para o mapa ficar ligado a ela e ser gravado na mesma pasta. Até 300 cartões e 5.000 caracteres por cartão. Recusa um segundo fluxo com o mesmo título na mesma pasta.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120, description: 'Título do fluxo. Vira o nome do arquivo .canvas.' },
        folder: { type: 'string', description: 'Pasta de destino relativa ao cofre. Sem isso, usa a pasta de sourceNote ou a raiz do cofre.' },
        nodes: {
          type: 'array', maxItems: 300, items: { type: 'object' },
          description: 'Cartões: { id, type: "text" | "note" | "link" | "group", text | note | url | label, color?, x?, y?, width?, height? }. color: "1" a "6" (vermelho, laranja, amarelo, verde, ciano, roxo) ou #rrggbb.',
        },
        edges: { type: 'array', maxItems: 600, items: { type: 'object' }, description: 'Ligações: { from, to, label?, color? }, com from/to sendo ids (apelidos) de "nodes".' },
        root: { type: 'string', description: 'Id (apelido) do cartão raiz da árvore.' },
        sourceNote: { type: 'string', description: 'Nota de origem (caminho ou título). Ganha um cartão ligado à raiz.' },
      },
      required: ['title', 'nodes'],
    },
    run: (api, args, ctx) => api.createFluxo(args, ctx),
    target: (args, resultado) => resultado?.fluxo?.path || args.title,
  },
  {
    name: 'get_vault_info',
    risk: 'read',
    permission: 'read',
    description: 'Informa o cofre aberto: caminho, revisão atual e quantidade de notas e pastas.',
    inputSchema: { type: 'object', properties: {} },
    run: (api, args, ctx) => api.describeVault(args, ctx),
    target: () => 'vault',
  },
];

const PERMISSAO_DE_RISCO = { read: 'read', write: 'write', destructive: 'destructive' };

class AgentToolkit {
  constructor({ api, audit, config }) {
    if (!api) throw new Error('AgentToolkit precisa de uma KiroAgentApi.');
    this.api = api;
    this.audit = audit || null;
    this.config = config || null;
    this.tools = new Map(FERRAMENTAS.map(f => [f.name, f]));
  }

  /** Descritores públicos, sem os handlers. */
  list() {
    return FERRAMENTAS.map(({ name, description, inputSchema, risk, permission }) => ({
      name, description, inputSchema, risk, permission,
      requiresConfirmation: PERMISSAO_DE_RISCO[risk] === 'destructive',
    }));
  }

  get(nome) { return this.tools.get(nome) || null; }

  async #permitir(ferramenta) {
    if (!this.config) return;
    const conf = await this.config.load();
    if (!conf.enabled) throw new AgentError('AGENT_DISABLED', 'A integração com agentes está desligada nas configurações do Kiro.');
    if (!conf.permissions[ferramenta.permission]) {
      throw new AgentError('PERMISSION_DENIED', `O Kiro está configurado para não permitir "${ferramenta.permission}" por agentes. Ajuste em AI & Integrations.`);
    }
  }

  /**
   * Executa uma ferramenta: valida o schema, confere a permissão, roda e audita.
   * Erros também são auditados — uma tentativa recusada é informação de auditoria.
   */
  async call(nome, args, contexto = {}) {
    const ferramenta = this.get(nome);
    if (!ferramenta) throw new AgentError('UNKNOWN_TOOL', `Ferramenta desconhecida: "${nome}".`);
    const cliente = { client: contexto.clientId || 'unknown', clientName: contexto.clientName };
    let validados = {};
    try {
      validados = validate(args, ferramenta.inputSchema);
      await this.#permitir(ferramenta);
      const resultado = await ferramenta.run(this.api, validados, { clientId: cliente.client, clientName: cliente.clientName });
      if (this.audit && ferramenta.risk !== 'read') {
        await this.audit.record({
          ...cliente, action: nome, risk: ferramenta.risk,
          target: ferramenta.target(validados, resultado), status: 'success',
          revisionBefore: resultado?.revisionBefore, revisionAfter: resultado?.revision,
        });
      }
      return resultado;
    } catch (erro) {
      if (this.audit && ferramenta.risk !== 'read') {
        await this.audit.record({
          ...cliente, action: nome, risk: ferramenta.risk,
          target: ferramenta.target(validados || {}, null), status: 'error',
          errorCode: erro.code || 'ERROR', error: erro.message,
        });
      }
      throw erro;
    }
  }
}

module.exports = { AgentToolkit, TOOL_DEFINITIONS: FERRAMENTAS };
