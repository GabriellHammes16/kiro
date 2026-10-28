# Ações rápidas e modelos pessoais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir ações nativas/plugins pelo teclado e criar notas a partir de modelos pessoais, preservando edições e o cofre.

**Architecture:** Duas entregas incrementais: paleta funcional, depois modelos integrados. `domain.js` recebe pequenas funções puras; `app.js` conecta catálogo, modal e fluxos existentes. Modelos são notas com tag explícita `modelo`, sem armazenamento adicional ou mudanças na persistência.

**Tech Stack:** JavaScript puro, HTML/CSS, Electron, Node `node:test`; dependências atuais.

**Spec:** [Design e critérios](../specs/2026-10-24-acoes-rapidas-modelos-pessoais.md).

## Global Constraints

- Sem dependência nova, serviço, migração do cofre ou API nova.
- Interface em PT-BR e inglês; conteúdo do usuário tratado como texto.
- Usar modal, tokens visuais e caminhos de gravação existentes; não reestruturar `app.js` inteiro.
- Funcionar no navegador e Electron; validar em cofre de desenvolvimento, nunca no pessoal.
- Preservar alterações preexistentes do workspace; não usar `git add .`, reset ou commits com trabalho de terceiros.
- Este plano não executa mudanças no produto. Revisão do usuário é a etapa seguinte antes da implementação.

## Review Focus

1. Ctrl+K já personalizado: não retirar o atalho de outra ação ao atualizar (T1).
2. Editor/rascunho sujo ou salvamento recusado: não descartar texto nem criar nota/fluxo parcialmente (T2/T4).
3. Fonte removida, plugin desativado ou cofre diferente entre abrir e executar: revalidar os alvos (T2/T4).
4. Títulos com HTML, `$&` e tokens, data perto da meia-noite: texto literal e substituição única com data local (T3).
5. Teclado/IME/foco: Enter não executa durante composição, cancelamento devolve foco e não pede descartar a consulta (T2).

## Delegação econômica

| Etapa | Modelo recomendado | Motivo |
|---|---|---|
| Levantamentos de atalhos e modelos | GPT-6 Luna, esforço médio | Leitura delimitada; concluídos nesta sessão por dois subagentes |
| T1 e T3: regras puras e testes | GPT-6 Luna, esforço médio | Interfaces pequenas e verificáveis |
| T2 e T4: modal, editor, integração | GPT-6.1 Sol, esforço médio | Estado assíncrono, foco e proteção de texto exigem mais contexto |
| T5: documentação e comandos de verificação | GPT-6 Luna, esforço baixo | Mudanças e execução mecânicas |
| Revisão final de T2/T4 e falhas relevantes | GPT-6.1 Sol, esforço alto | Uma revisão integrada focada em perda de dados e acessibilidade |

Não estimar preço sem a tabela vigente do serviço. Reduzir contexto enviando ao executor só spec, tarefa e arquivos necessários. Escalar tarefa da Luna para Sol apenas após falha concreta ou ambiguidade de integração. Executar T1→T2→T3→T4→T5 sequencialmente, pois compartilham arquivos; paralelizar somente leituras. Se o executor aplicar a skill de subagentes, cumprir seus gates de revisão, mantendo Luna em mudanças simples e Sol nos riscos de integração. Não subir ao modelo mais caro por padrão.

## Mapa de arquivos

| Arquivo | Responsabilidade da mudança |
|---|---|
| `domain.js` | Atalho, filtro puro de ações, catálogo/expansão de modelos |
| `app.js` | Paleta, ações, formulários de modelos e integração com editor/plugins |
| `index.html` | Botão visível de Ações rápidas na lateral |
| `styles.css` | Estilo compacto de lista/seleção/foco usando variáveis existentes |
| `idiomas/en.js` | Traduções das novas frases marcadas com `t()`/`frase()` |
| `tests/atalhos.test.cjs` | Padrões e migração de atalhos |
| `tests/acoes-rapidas.test.cjs` (novo) | Filtro e comportamento do modal com DOM mínimo instrumentado |
| `tests/modelos.test.cjs` (novo) | Regras de modelo e proteção do fluxo de criação |
| `tests/nota.test.cjs`, `tests/plugins.test.cjs` | Regressões do seletor/editor e execução de comandos |
| `tests/idiomas-cobertura.test.cjs` | Executar cobertura; mudar apenas se necessário, sem relaxar regras |
| `README.md`, `docs/plugins.md` | Uso dos recursos e novo acesso aos comandos |

Sem novos scripts de produto: `server.mjs`, preload, MCP, `vault.cjs` e empacotamento não devem precisar mudar. Modelos usam as notas já lidas por `state.notes`.

## T1 — Regras da paleta e atalho

**Executor:** Luna. **Files:** `domain.js`, `tests/atalhos.test.cjs`, novo `tests/acoes-rapidas.test.cjs`, `idiomas/en.js`.

**Interfaces:** adicionar `acoesRapidas` a `ATALHOS_EDITAVEIS`; exportar `filtrarAcoes(acoes, consulta, limite = 12)`, onde cada ação tem `{id, titulo, categoria}` e a função retorna os objetos originais. A UI traduz os títulos antes de montar o catálogo; a função não traduz nem executa callbacks.

- [ ] Escrever testes: defaults incluem `acoesRapidas: 'Ctrl+K'`; atalhos antigos continuam iguais; personalização antiga `irPara: 'Ctrl+K'` permanece e a nova ação recebe `Ctrl+Shift+P`; com esse ocupado também, usar a próxima combinação livre definida na spec. Preferência contendo a nova ação continua remapeável e sem duplicatas.
- [ ] Escrever testes do filtro: `nova` encontra Nova nota/Nova tarefa/Novo fluxo na ordem de entrada; `revisao` encontra Revisão; `plugin resumo` exige ambos os termos; busca sem resultados retorna `[]`; limite 12; entrada não é mutada.
- [ ] Rodar `node --test tests/atalhos.test.cjs tests/acoes-rapidas.test.cjs` e confirmar falha pelos novos comportamentos ausentes.
- [ ] Implementar as regras mínimas em `domain.js`, exportá-las e traduzir a nova linha de atalho. Não alterar o formato das preferências.
- [ ] Repetir os testes acima e `node --test tests/idiomas-cobertura.test.cjs`; exigir zero falhas. Revisar somente o diff da tarefa antes de seguir.

## T2 — Menu funcional com ações e plugins

**Executor:** Sol. **Files:** `app.js`, `index.html`, `styles.css`, `idiomas/en.js`, `tests/acoes-rapidas.test.cjs`, `tests/plugins.test.cjs`.

**Consumes:** T1, `modal`, `closeModal`, `teclaDe`, `Kiro.normalize`, `pluginsAtivos`, `rodarComandoDoPlugin`.
**Produces:** `abrirAcoesRapidas()` e `catalogoDeAcoes()` em `app.js`. Catálogo contém `{id, titulo, categoria, executar}`; nativas usam IDs estáveis e plugins `plugin:<id>:<comando>`. T4 acrescenta duas ações de modelos nesse catálogo.

- [ ] Criar testes comportamentais pequenos com `node:vm`/DOM instrumentado, seguindo o padrão de `tests/pdf-nota.test.cjs`: guardas de abertura, seleção com teclado, Enter único, `isComposing`, consulta sem confirmação de descarte, foco após cancelar, plugin removido entre listar/executar. Não considerar só regex no fonte como validação do fluxo.
- [ ] Rodar os novos testes e confirmar falha antes da implementação.
- [ ] Montar catálogo nativo usando `abrirNota(notaVazia())`, `taskModal()`, `novoFluxo`, `capturaRapida()`, `extraAction('daily')`, `irParaNota()` e `showSettings()`. Conferir antes os chamadores dessas funções; usar os mesmos argumentos e proteções das ações atuais.
- [ ] Implementar o modal reaproveitando `modal()` e classes de `irParaNota()`, sem tornar o texto da busca `modalDirty`. Rotular diálogo e combobox, conectar `aria-controls`/`aria-activedescendant` a opções com IDs, conter Tab/Shift+Tab e devolver foco em cancelamentos. Limpeza deve cobrir Esc, botão e clique fora sem listeners pendurados. Evitar reabrir quando já há modal.
- [ ] Fechar a paleta antes de ações que abrem outro modal, preservar a nota atual e deixar a nova ação controlar o foco. Revalidar plugin e registro imediatamente antes de `rodarComandoDoPlugin`. Bloquear duplo disparo. Novo fluxo deve passar pela proteção de salvamento antes de gravar/criar; não presumir que sua abertura posterior protege a criação anterior.
- [ ] Adicionar botão visível e ação `ACOES_DOS_ATALHOS.acoesRapidas`; exibir atalho efetivo com `teclaDe`. Traduzir rótulos e estados vazios, escapando nomes de plugins.
- [ ] Rodar `node --test tests/acoes-rapidas.test.cjs tests/atalhos.test.cjs tests/plugins.test.cjs tests/idiomas-cobertura.test.cjs`; exigir zero falhas. Entrega A: paleta útil, sem modelos ainda.

## T3 — Catálogo e expansão dos modelos

**Executor:** Luna. **Files:** `domain.js`, novo `tests/modelos.test.cjs`.

**Consumes:** `Kiro.localDate` (já exportada), `Kiro.normalize`, notas do cofre.
**Produces:** `modelosPessoais(notas)` → notas com tag explícita exata `modelo`; `expandirModelo(corpo, {title, date})` → string. `date` é fornecida pelo chamador via `today()`. As funções são puras e não escrevem no cofre.

- [ ] Testar inclusão por `note.tags`, exclusão de hashtag apenas no corpo, `modelos` e `modelo/a`, comparação normalizada e ausência de mutação.
- [ ] Testar `expandirModelo('# {{title}} / {{date}}', {title: 'Teste', date: '2026-10-24'}) === '# Teste / 2026-10-24'`; múltiplas ocorrências; token desconhecido preservado; título literal `$& {{date}}` não sofre substituição recursiva; corpo vazio.
- [ ] Rodar `node --test tests/modelos.test.cjs`, confirmar falha e implementar as duas funções em `domain.js`. Usar substituição única com callback para os dois tokens, sem eval ou parser novo.
- [ ] Repetir `node --test tests/modelos.test.cjs tests/nota.test.cjs` e exigir zero falhas.

## T4 — Modelos no menu e no editor

**Executor:** Sol. **Files:** `app.js`, `idiomas/en.js`, `tests/modelos.test.cjs`, `tests/nota.test.cjs`, `tests/acoes-rapidas.test.cjs`.

**Consumes:** T2/T3, `templates` existentes, `notaVazia`, `salvarAntesDeTrocar`, `abrirNota`, `getNote`, editor `.area().inserir()`.
**Produces:** `catalogoDeModelos()` → `{chave,titulo,pasta,body,tags,links}`; chaves `embutido:<nome>` e `nota:<id>`. `criarNotaPorModelo()` controla seleção/título; `criarModeloPessoal()` abre rascunho com tag de controle. Não criar novo estado persistido.

- [ ] Escrever testes do fluxo: fonte intacta; identidade/datas/arquivo não copiados; tag de controle removida da cópia; links externos copiados por valor; novo rascunho marcado dirty; modelo excluído ou troca de cofre aborta; tags/conteúdo pertencem somente ao cofre atual.
- [ ] Testar cancelamento em seleção e título sem tocar no editor; título vazio ou >200 impede continuação; falha do salvamento anterior mantém texto e formulário preenchido; rascunho antigo sem título não é perdido. Verificar que o seletor anterior ainda confirma substituição e uma transação do editor permite desfazer.
- [ ] Rodar testes e confirmar falha; montar catálogo com os três embutidos e modelos pessoais identificados pela pasta (homônimos não usam título como chave).
- [ ] Integrar as duas ações à paleta. Capturar identidade do cofre e pasta ao iniciar; ao confirmar, salvar a nota anterior, reler o modelo pelo ID (inclusive se era a nota editada), verificar cofre/fonte, expandir com título aparado e `today()`, preparar rascunho com cópias de tags/links e sem campos de identidade. Fechar formulário somente após salvamento protetor bem-sucedido, abrir e marcar dirty pelo caminho de edição existente.
- [ ] Incluir pessoais no `#doc-template` pelo mesmo catálogo. Manter a confirmação existente e inserção pelo editor para preservar Ctrl+Z; usar título atual, pedindo-o quando necessário para `{{title}}`. Não substituir diretamente o HTML do editor. Revalidar fonte antes de aplicar.
- [ ] Traduzir interface, inclusive exemplos e instrução “Adicione modelo no campo de tags”. Não transformar o conteúdo arbitrário das notas em chaves de tradução.
- [ ] Rodar `node --test tests/modelos.test.cjs tests/nota.test.cjs tests/acoes-rapidas.test.cjs tests/idiomas-cobertura.test.cjs`; exigir zero falhas. Entrega B: modelos pessoais completos.

## T5 — Verificação integrada e documentação

**Executor:** Luna para documentação/checks; Sol para revisão da integração.
**Files:** `README.md`, `docs/plugins.md`, arquivos corrigidos pelos checks, `graphify-out/` após atualização.

- [ ] Documentar botão/atalho configurável, exemplos `{{date}}`/`{{title}}`, campo de tags, criação por modelo, aplicação no editor e limite dos links relativos. Corrigir a frase antiga do README que diz não haver plugins/grafo/prévia.
- [ ] Atualizar `docs/plugins.md`: comandos também ficam em Ações rápidas; API/permissões não mudam.
- [ ] Executar `npm.cmd test` e `git diff --check`. Baseline desta análise: 407 passaram, 1 ignorado, zero falhas; comparar falhas com o workspace atual, que já contém mudanças. Não relaxar testes existentes para obter verde.
- [ ] Usar `npm run dev` no cofre de exemplo; nunca `dev:reset` sem necessidade. Validar por teclado e mouse: ação vazia/filtrada, Esc/Tab/Enter, foco e rolagem, plugin ligado/desligado, nomes com HTML, nota suja, falha de gravação, criação/aplicação de modelo e desfazer, mudança de cofre, PT/EN e janela estreita.
- [ ] Validar Electron com `npm run desktop:dev`: atalho com foco no CodeMirror e em campos comuns, modais e proteção de rascunhos. Conferir efetiva captura de Ctrl+K e comandos consumidos pelo editor; corrigir no ponto mais restrito, sem retirar atalhos do editor globalmente.
- [ ] Revisão integrada por Sol: confrontar diff com spec, principalmente criação parcial, foco e revalidação de fonte/plugin. Corrigir achados e repetir apenas os checks afetados, depois suíte final se houver mudança lógica.
- [ ] Após mudanças de código significativas, ler a skill graphify e executar a atualização prevista no AGENTS (`/graphify . --update`); inspecionar resultado. Não regenerar grafo apenas por este plano.
- [ ] Registrar resultado dos testes e limitações reais no handoff. Se commits fizerem parte da execução autorizada, separar por entrega e selecionar somente os próprios hunks; não commitar mudanças anteriores do usuário.

## Fora desta entrega

Sem IA, histórico de uso, modelos com scripts/campos arbitrários, catálogo remoto, atalhos individuais por plugin, refatoração geral, mudanças no MCP ou instalador. Esse recorte entrega as duas funções pedidas com menor superfície de mudança.

## Resultado da execução — 24/10/2026

- [x] T1: filtro e atalho com migração de preferências.
- [x] T2: menu acessível, ações e plugins; revisão e correções de captura/IME.
- [x] T3: identificação e expansão dos modelos.
- [x] T4: criação e aplicação no editor; revisão e feedback de falha de gravação.
- [x] T5: documentação, suíte completa, QA navegador/Electron, revisão final e grafo.

Resultado: 433 testes passaram, 0 falharam, 1 foi ignorado. Smoke Electron com perfil/cofre isolados passou em 9 checks. Revisão final aprovada. Grafo de código atualizado com 2000 nós, 4096 arestas e 153 comunidades, sem chamadas de LLM.

A recuperação existente do cofre prevalece sobre a promessa inicial de retry imediato: falha real mantém o bloqueio, preserva o formulário, explica a recuperação e desabilita Continuar. O usuário reabre o pedido após recuperar o cofre. A busca segue termos literais; `nov` encontra Nova/Novo.

O trabalho foi mantido no workspace com snapshots das alterações preexistentes, sem commits. O registro detalhado está em `.superpowers/sdd/acoes-rapidas-modelos-2026-10-24/progress.md`; os checkboxes do roteiro acima não foram usados como evidência de execução — os relatórios por tarefa contêm os comandos e resultados reais.

Limites de validação: instalador não gerado, IME físico e desfazer do textarea de fallback não testados manualmente. Caminhos relativos e cópia de anexos permanecem fora do escopo. Atualização do grafo foi de código; semântica dos documentos não reextraída. O parser do grafo alertou para `tests/plugins-rede.test.cjs`, arquivo preexistente que passou no `node --check` e na suíte.
