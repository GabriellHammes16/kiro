# Kiro Agent API

Camada única por onde agentes de IA — e qualquer outro cliente que não seja a
interface gráfica — falam com o cofre do Kiro.

O Kiro continua funcionando normalmente sem nenhuma IA conectada. Esta camada é
uma capacidade a mais, desligável, e não fala com nenhum serviço externo.

## Arquitetura

```
        Mico        Claude       outro agente
          └────────────┼────────────┘
                  MCP / Tool Interface        mcp/server.mjs
                       │
                  AgentToolkit                agent/tools.cjs
                  schema · permissão · auditoria
                       │
                  KiroAgentApi               agent/api.cjs
                  notes · search · folders · links · tags
                       │
                     Vault                    vault.cjs
                       │
                Markdown local                <cofre>/**/*.md
```

Duas regras sustentam o desenho:

1. **A Agent API não reimplementa persistência.** Toda escrita passa por
   `Vault.save()`, que já faz gravação atômica, checagem de revisão, snapshot em
   `.history/` e arquivamento em `.trash/`. Uma nota criada por agente percorre
   exatamente o mesmo caminho de uma nota criada na interface.
2. **O MCP não conhece arquivos.** `mcp/server.mjs` só traduz protocolo. Trocar
   MCP por CLI, plugin ou automação não exige tocar em nada abaixo dele.

### Onde fica cada coisa

| Arquivo | Responsabilidade |
|---|---|
| `agent/security.cjs` | Validação de caminhos, nomes e tags. Recusa o que vem de fora. |
| `agent/schema.cjs` | Validador do subconjunto de JSON Schema das ferramentas. |
| `agent/api.cjs` | Operações do cofre. Agnóstico de interface e de fornecedor de IA. |
| `agent/tools.cjs` | Catálogo, permissões e auditoria. Porta de entrada dos agentes. |
| `agent/audit.cjs` | Log JSONL em `<cofre>/.kiro/audit.log`. |
| `agent/config.cjs` | Configuração em `<cofre>/.kiro/agent.json`. |
| `agent/events.cjs` | Barramento de eventos internos. |
| `agent/index.cjs` | Monta a pilha e descobre qual cofre usar. |

`.kiro/` fica dentro do cofre mas fora do alcance do varredor de notas: o
`scan()` do Vault ignora entradas ocultas na raiz, então esses arquivos nunca
viram nota nem entram na lista de remoções. A configuração acompanha o cofre
quando ele é copiado para outra máquina.

## Uso como biblioteca

```js
const { createKiroAgent } = require('./agent/index.cjs');

const { api, toolkit } = createKiroAgent({ vaultDirectory: 'C:/MeuCofre' });

// Fachada direta, para a interface e para código de dentro do Kiro:
await api.notes.create({ title: 'Ideias', folder: 'Projetos', content: '...' });
await api.notes.search({ query: 'python' });

// Porta dos agentes: valida schema, confere permissão e audita.
await toolkit.call('create_note', { title: 'Ideias' }, { clientId: 'mico', clientName: 'Mico' });
```

O cofre é resolvido nesta ordem: argumento explícito, `KIRO_VAULT`, cofre
escolhido no aplicativo desktop, `Documentos/Kiro/vault`, cofre do projeto.

## Ferramentas

Nomes sem prefixo. A camada MCP publica os mesmos com `kiro_` na frente.

### Notas

| Ferramenta | Risco | Permissão | O que faz |
|---|---|---|---|
| `create_note` | write | create | Cria nota Markdown; cria as pastas do caminho; recusa título duplicado na mesma pasta. |
| `read_note` | read | read | Lê por `id` ou `path`; devolve conteúdo, metadados e datas. |
| `update_note` | write | update | `replace`, `append` ou `prepend`; também muda título, tags e pasta. |
| `delete_note` | destructive | delete | Move para a lixeira e devolve `trashEntryId`. |
| `restore_note` | write | update | Restaura da lixeira pelo `trashEntryId`. |
| `list_notes` | read | read | Lista notas, filtrando por pasta e período (`since`/`until`, AAAA-MM-DD) e paginando. |
| `search_notes` | read | read | Busca em título, caminho, tags e corpo, com trechos. Aceita período (`since`/`until`). |
| `move_note` | write | update | Move a nota para outra pasta. |
| `get_recent_notes` | read | read | Notas alteradas mais recentemente. |
| `get_daily_note` | read | read | Nota do dia; não cria nada. |
| `get_habits` | read | read | Hábitos com sequência, cumprimento em 30 dias e últimos 7 dias. |
| `list_trash` | read | read | Itens restauráveis na lixeira. |

### Pastas, links e tags

| Ferramenta | Risco | Permissão |
|---|---|---|
| `create_folder` | write | create |
| `list_folders` | read | read |
| `get_backlinks` | read | read |
| `get_outgoing_links` | read | read |
| `create_note_link` | write | update |
| `add_tag` | write | update |
| `remove_tag` | write | update |
| `search_by_tag` | read | read |
| `get_vault_info` | read | read |

### Fluxos

Fluxos são arquivos `.canvas` no formato aberto JSON Canvas, compatível com o Obsidian.
A IA manda a estrutura (cartões e ligações) e o Kiro posiciona.

| Ferramenta | Risco | Permissão | O que faz |
|---|---|---|---|
| `list_fluxos` | read | read | Lista id, caminho, título, pasta e quantidade de cartões e ligações. Fluxo corrompido vem com `error`. |
| `read_fluxo` | read | read | Lê por `id` ou `path`: cartões `{ id, type, text \| note \| url \| label \| file, color }` e ligações `{ id, from, to, label }`. `positions: true` inclui `x`, `y`, `width`, `height`. |
| `create_fluxo` | write | create | Cria a partir de `{ title, folder?, nodes, edges?, root?, sourceNote? }`. Cartões sem posição viram uma árvore da esquerda para a direita. |
| `update_fluxo` | write | update | `add_nodes`, `add_edges`, `update_nodes`, `remove_nodes`, `remove_edges`. Cartões novos sem posição entram perto do pai, sem mexer nos existentes. |

- O `id` de cada cartão em `create_fluxo` e `add_nodes` é um apelido; as ligações usam os
  apelidos e a resposta devolve `ids: { apelido: idReal }`.
- `note` aceita caminho (`"Estudos/Python.md"`) ou título. Nota que não existe recusa a
  chamada inteira (`NOTE_NOT_FOUND`, com `details.missing`).
- Limites: 300 cartões por lista, 600 ligações e 5.000 caracteres por campo de texto (`text`, `label`).
- Tudo-ou-nada: qualquer erro vira `AgentError` e nada é gravado. Fluxo com o arquivo
  corrompido devolve `FLUXO_INVALID` e não é tocado.
- Eventos: `fluxo.created` e `fluxo.updated`.

Exemplo: "transforma a nota Listas num fluxo". O agente lê a nota com `read_note` e chama:

```jsonc
// create_fluxo
{ "title": "Listas (mapa)", "sourceNote": "Estudos/Python/Listas.md",
  "nodes": [
    { "id": "raiz", "type": "text", "text": "# Listas" },
    { "id": "criar", "type": "text", "text": "## Criar" },
    { "id": "ex1", "type": "text", "text": "```python\nxs = [1, 2, 3]\n```" },
    { "id": "metodos", "type": "text", "text": "## Métodos" },
    { "id": "append", "type": "text", "text": "`append` põe no fim" }
  ],
  "edges": [
    { "from": "raiz", "to": "criar" }, { "from": "criar", "to": "ex1" },
    { "from": "raiz", "to": "metodos" }, { "from": "metodos", "to": "append" }
  ] }
// resposta
{ "success": true, "fluxo": { "id": "…", "path": "Estudos/Python/Listas (mapa).canvas",
  "title": "Listas (mapa)", "folder": "Estudos/Python", "cards": 6, "links": 5 },
  "ids": { "raiz": "3f9c…", "criar": "a01b…", "ex1": "…", "metodos": "…", "append": "…" } }
```

### Tarefas

Mesmas regras da aba Tarefas: status `nao-comecado`, `andamento`, `pausado` ou `concluido`;
concluir marca a tarefa como feita e guarda o status de antes, para reabrir onde estava.

| Ferramenta | Risco | Permissão | O que faz |
|---|---|---|---|
| `list_tasks` | read | read | Lista id, título, descrição, `due`, prioridade, status, `overdue`, nota associada e notas que citam a tarefa. Filtro opcional por `status`. |
| `create_task` | write | create | `{ title, due?, priority?, description?, note?, status? }`. Sem `due` vence hoje; sem `priority`, "Média". `note` é caminho `.md` ou título exato. |
| `update_task` | write | update | Por `id`, muda só os campos enviados (inclusive `status`). `description: ""` e `note: ""` apagam. |
| `set_task_status` | write | update | `{ id, status }`: o jeito curto de concluir, pôr em andamento, pausar ou reabrir. |
| `delete_task` | destructive | delete | Exclui por `id`. **Definitivo**: tarefa não tem lixeira (`recoverable: false`). |

- Eventos: `task.created`, `task.updated` e `task.deleted`.
- Erro próprio: `TASK_NOT_FOUND` (id inexistente).

### Schemas

Exemplos. `toolkit.list()` devolve o schema completo de cada ferramenta.

```jsonc
// create_note
{ "title": "Ideias Mico", "folder": "Projetos/Mico", "content": "# Ideias\n...", "tags": ["ia", "mico"] }
// resposta
{ "success": true, "note": { "id": "…", "path": "Projetos/Mico/ideias-mico-….md",
  "title": "Ideias Mico", "folder": "Projetos/Mico", "tags": ["ia","mico"] } }

// update_note, acrescentando sem reescrever a nota inteira
{ "id": "…", "content": "Mais uma ideia.", "mode": "append" }

// search_notes
{ "query": "assistente pessoal", "limit": 20 }
{ "results": [ { "path": "Projetos/Mico.md", "title": "Mico",
  "snippet": "…assistente pessoal capaz de…" } ] }
```

O nome do arquivo segue a convenção do próprio Kiro: `<título-em-slug>-<id>.md`.
É a mesma regra usada quando você cria uma nota na interface, e o sufixo com id
garante que nenhuma criação sobrescreve arquivo existente.

## Permissões

Cada ferramenta declara **risco** e **permissão**.

- **risk** — `read`, `write` ou `destructive`. Serve para o cliente decidir
  quando pedir confirmação ao usuário. Vai também nas *annotations* do MCP.
- **permission** — `read`, `create`, `update` ou `delete`. É o que o Kiro
  checa contra a configuração antes de executar.

A porta de permissão fica no `AgentToolkit`, não na `KiroAgentApi`. A interface
gráfica usa a API direto e não é barrada: ali quem age é o próprio usuário.

Configuração em `<cofre>/.kiro/agent.json`, editável pela tela **Configurações**,
seção IA e integrações, na barra lateral:

```json
{
  "enabled": true,
  "mcp": { "enabled": true },
  "permissions": { "read": true, "create": true, "update": true, "delete": false },
  "requireConfirmationForDestructive": true
}
```

**Excluir vem desligado por padrão.** Arquivo ausente ou corrompido cai no
padrão — nunca em permissão mais aberta.

## Segurança

Toda entrada de agente é tratada como não confiável.

- Caminho precisa ser relativo ao cofre. São recusados `..`, `../`, `..\`,
  barra invertida, unidade de disco (`C:`), caminho iniciado em `/` ou `~`,
  caractere nulo e mais de 15 níveis.
- Nomes ocultos (iniciados em `.`) são recusados, assim como `.history`,
  `.trash`, `.staging`, `.kiro`, `caderno.json` e o journal de transação.
- Nomes de pasta passam pela mesma validação da interface: sem `< > : " / \ | ?
  *`, sem nomes reservados do Windows, sem ponto ou espaço nas pontas.
- Abaixo disso, o `safePath()` do Vault ainda confere o caminho resolvido e
  recusa link simbólico dentro das pastas gerenciadas — segunda barreira,
  independente desta.
- O validador de schema recusa **campo desconhecido**, tipo errado e obrigatório
  ausente. Um argumento a mais na chamada é erro, não é ignorado.
- Não existe e não deve existir ferramenta genérica: nada de `read_any_file`,
  `write_any_file`, `run_shell` ou `execute`. A API só manipula recursos do Kiro.
- Exclusão nunca é permanente: `delete_note` move para a lixeira e devolve o
  identificador de recuperação. Não há exclusão permanente exposta a agentes.

## Auditoria

Toda operação de escrita gera uma linha em `<cofre>/.kiro/audit.log` (JSONL),
inclusive as recusadas — uma tentativa negada é informação de auditoria.

```json
{"timestamp":"2026-09-09T12:00:00.000Z","client":"mico","clientName":"Mico",
 "action":"create_note","risk":"write","target":"Projetos/Mico/Ideias.md",
 "status":"success","revisionBefore":"a1b2…","revisionAfter":"c3d4…"}
```

O log guarda identificadores, caminhos e resultado. **Nunca guarda conteúdo de
nota, token ou segredo** — há teste garantindo isso. `revisionBefore` e
`revisionAfter` são o gancho para um Undo futuro: cada gravação do Vault já
deixa um snapshot em `.history/`. O arquivo é rotacionado aos 5 MB.

Leituras não entram no log, para que ele continue sendo um histórico de
alterações legível.

## Eventos

`agent/events.cjs` emite `note.created`, `note.updated`, `note.deleted`,
`note.moved`, `note.restored`, `folder.created`, `fluxo.created`, `fluxo.updated`,
`task.created`, `task.updated` e `task.deleted`, com `source` e `clientId`.

```js
const { events } = createKiroAgent({ vaultDirectory });
events.on('note.created', ({ path, source, clientId }) => { /* índice, embeddings… */ });
```

Ainda não há consumidor. Existe para que índice, busca semântica, sincronização
e automações possam ser ligados depois sem mexer na Agent API.

## Identificação do cliente

Opcional e sem efeito na lógica:

```js
toolkit.call('create_note', args, { clientId: 'mico', clientName: 'Mico' });
```

Serve só para a auditoria. Não existe caminho de código condicionado a um
cliente específico — a Mico é tratada como qualquer outro agente autorizado.

## Privacidade

O Kiro não envia conteúdo do cofre para lugar nenhum. Ele responde quando uma
ferramenta pede, e só isso. Não há chave de OpenAI, Anthropic, OpenRouter ou
qualquer outro provedor nesta camada: o modelo é responsabilidade do cliente.

## Limitações conhecidas

- Busca é textual. A pontuação está isolada em `searchNotes` para que uma busca
  semântica possa ser somada depois sem mudar a assinatura da ferramenta.
- Campos YAML personalizados são preservados no disco pelo Vault, mas não são
  editáveis por esta API — ela expõe os campos que o Kiro modela.
- `createdAt` vem do sistema de arquivos; o Kiro não guarda data de criação
  própria. Notas sem arquivo em disco devolvem `null`.
- Não há exclusão permanente nem operações em lote.
