# Painel da direita (links, sumário e etiquetas)

Data: 2026-09-19 · Estado: aprovado no brainstorming.

## Objetivo

Um painel à direita das colunas, na tela de Pastas, com as ligações e a estrutura da
nota em edição — no modelo do Obsidian — para navegar e ligar ideias sem sair da nota.

## Decisões

| Assunto | Decisão |
|---|---|
| Onde | Só na tela de Pastas, à direita das colunas |
| Abrir/fechar | Botão ◨ no fim da barra de abas da última coluna e atalho editável `Ctrl+Shift+L` ("Painel da direita") |
| Estado inicial | Fechado; lembra aberto/fechado, a aba escolhida e a largura (`localStorage`, não o cofre) |
| Largura | Divisória na borda esquerda do painel, 220–520 px, padrão 300; dois cliques voltam ao padrão |
| Abas do painel | Links de volta · Links de saída · Sumário · Etiquetas (ícones no topo, `aria-pressed`) |
| Nota de referência | A nota em edição (`editing`); sem nota, cada aba mostra um vazio curto |
| Janela estreita | Abaixo de 900 px o painel não aparece (o botão também some) |

## Conteúdo

- **Links de volta**
  - *Menções vinculadas*: notas com `[[link]]` que resolve para esta nota (`Kiro.mentions`),
    cada uma com a linha onde o link aparece (texto plano). Contagem no cabeçalho.
  - *Menções não vinculadas*: notas que escrevem o título desta nota fora de `[[…]]`,
    sem diferenciar maiúsculas nem acentos, como palavra inteira; título com menos de 3
    caracteres não gera menções. Cada item tem o botão **Vincular**, que troca a primeira
    ocorrência por `[[Título]]` (ou `[[Título|texto original]]` se o texto diferir) na
    outra nota e salva. Se a outra nota for a nota em edição com alterações não salvas,
    recusa com aviso.
  - Campo de filtro que filtra as duas listas pelo título da nota.
- **Links de saída**: os `[[links]]` desta nota, sem repetir, na ordem do texto; os que
  apontam para notas inexistentes aparecem marcados. Clicar abre a nota (inexistente:
  abre uma nota nova com esse título, como o link no texto já faz).
- **Sumário**: os títulos Markdown (`#` a `######`) fora de blocos de código, em
  árvore pelo nível. Clicar rola a nota em edição até o título.
- **Etiquetas**: todas as etiquetas do cofre (`Kiro.tags`), aninhadas por `/`
  (`estudo/python` fica dentro de `estudo`), com o número de notas (uma nota conta uma
  vez por etiqueta, somando as filhas). Clicar abre a busca por aquela etiqueta
  (`buscarEtiqueta`).

## Lógica pura (`domain.js`, testada)

- `mencoesNaoVinculadas(notas, nota) → [{ nota, trecho }]`
- `vincularMencao(corpo, titulo) → corpo` (mesmo corpo se não houver menção)
- `sumario(corpo) → [{ nivel, texto, indice }]` (`indice` = ordem entre os títulos)
- `arvoreDeEtiquetas(notas) → [{ nome, caminho, total, filhos: [...] }]` (ordenada por nome)
- Atalho novo em `ATALHOS_EDITAVEIS`: `['painelDireito', 'Painel da direita', 'Links, sumário e etiquetas da nota, na tela de Pastas.', 'Ctrl+Shift+L']`.

## Fora do escopo

Painel em outras telas, propriedades/metadados, grafo local no painel, busca no cofre.
