# Abas e tela dividida na tela de Pastas

Data: 2026-09-19 · Estado: aprovado no brainstorming.

## Objetivo

Trabalhar com várias notas abertas na tela de Pastas (abas) e com duas notas lado
a lado (tela dividida), no modelo do Obsidian: cada metade tem a própria barra de
abas. Só uma nota está em edição por vez; a outra metade mostra a nota em leitura.

## Decisões

| Assunto | Decisão |
|---|---|
| Onde | Só na tela de Pastas (`currentView === 'studies'`). As outras telas não mudam |
| Metades | No máximo duas (esquerda e direita), cada uma com as próprias abas |
| Edição | Uma nota editável por vez (o editor continua único: `editing`). A outra metade é leitura |
| Trocar de lado | Clicar na metade em leitura salva a nota em edição (como `abrirNota` já faz) e passa a editar a clicada. Se salvar falhar, nada muda |
| Clique na árvore | Troca a nota da aba ativa; Ctrl+clique ou botão do meio abre em aba nova |
| Nota já aberta | Abrir uma nota que já tem aba (em qualquer metade) ativa essa aba; nunca duplica |
| Dividir | Arrastar uma aba para a metade direita da área de notas; botão direito na aba → "Abrir à direita/à esquerda" |
| Juntar | Arrastar a aba para a barra do outro lado; fechar a última aba de um lado volta a uma metade |
| Largura | Divisória arrastável entre as metades; proporção entre 0,2 e 0,8, cada lado ≥ 320 px |
| Memória | Abas, divisão e proporção voltam ao reabrir; gravado no computador (`localStorage`), por cofre, nunca no cofre |
| Janela estreita | Abaixo de 900 px as metades empilham; abaixo de 780 px (celular) não há divisão |

## Modelo (puro, testável)

Arquivo novo `abas.js` (mesmo formato do `plugins.js`: `module.exports` no Node,
`globalThis.KiroAbas` no navegador). Funções imutáveis sobre:

```js
{ paineis: [{ abas: ['id1', 'id2'], ativa: 'id2' }, …], ativo: 0, proporcao: 0.5 }
```

- `paineis` tem 1 ou 2 itens; `ativo` é o índice da metade ativa.
- Uma aba é o id de uma nota. Nota nova ainda não salva usa o id reservado
  `RASCUNHO` (`'kiro:rascunho'`); ao salvar, `trocarId(estado, RASCUNHO, idNovo)`.
- Um id aparece no máximo uma vez no estado inteiro.

Funções: `vazio()`, `abrir(e, id, { novaAba, painel })`, `ativar(e, painel, id)`,
`fechar(e, painel, id)`, `fecharOutras(e, painel, id)`, `mover(e, de, id, para)`
(`para` pode ser 0 ou 1; mover para 1 com uma metade só cria a segunda),
`trocarId(e, antigo, novo)`, `limpar(e, idsExistentes)` (valida o que veio do
`localStorage`: formato estranho vira `vazio()`; ids inexistentes saem; metade vazia
some; `ativa`/`ativo` corrigidos), `proporcao(e, p)` (limita a 0,2–0,8) e
`notaAtiva(e)` (id da aba ativa da metade ativa, ou `null`).

Regras que os testes cobrem:
- `abrir` sem `novaAba` troca o id da aba ativa; com `novaAba` insere à direita da ativa.
- Abrir id já aberto ativa a aba e a metade dele, sem duplicar.
- `fechar` ativa a vizinha da direita (ou da esquerda); metade vazia com duas metades some e `ativo` passa a 0.
- `mover` para o mesmo lado não faz nada; mover a última aba de um lado desfaz a divisão.
- `limpar` recusa lixo (`null`, string, `paineis` vazio, mais de 2 metades) e tira ids repetidos.

## Interface

- **Barra de abas** no topo de cada metade: título da nota (ou "Sem título"), × para
  fechar, botão do meio fecha, + no fim abre nota nova naquela metade. A aba ativa da
  metade ativa fica destacada; a barra da metade ativa tem um realce sutil.
- **Metade em leitura:** `renderizarMarkdown` da versão salva da nota, com links
  `[[…]]` clicáveis (abrem na própria metade), fórmulas e blocos de plug-in. Clicar em
  qualquer ponto dela (fora de link) a torna ativa e abre a nota em edição.
- **Arrastar aba:** `draggable` nas abas; ao arrastar sobre a área de notas, a metade
  de destino fica destacada (direita da área → nova metade/lado direito; barra de
  abas do outro lado → mover para lá). Soltar aplica `mover`.
- **Botão direito na aba:** "Abrir à direita"/"Abrir à esquerda", "Fechar",
  "Fechar as outras" — pelo menu de contexto que o app já tem (`abrirMenuContexto`).
- **Divisória** entre as metades: mesma mecânica da divisória da árvore (arrastar,
  setas do teclado, dois cliques voltam a 0,5), `role="separator"`.
- Sem aba nenhuma, a área mostra o vazio de hoje ("Escolha uma nota na árvore ao lado").

## Integração com o que existe

- `abrirNota(nota, { novaAba, painel })` passa a atualizar o modelo; o que chama hoje
  continua funcionando (sem opções = trocar a aba ativa).
- `editing` continua sendo a nota da aba ativa da metade ativa. `render()` desenha as
  duas metades; `bindEditor()` só liga o editor na metade ativa.
- Nota salva pela primeira vez: `trocarId(RASCUNHO, id)`. Nota excluída, movida para a
  lixeira ou sumida numa recarga: `limpar` tira a aba.
- Ir para outra tela (Hoje, Notas…) guarda as abas; voltar a Pastas as mostra de novo.
- O item ativo na árvore (`.tree-note.ativa`) segue a nota em edição.

## Testes

- `tests/abas.test.cjs`: as regras do modelo acima.
- Navegador (cofre de exemplo): abrir, trocar, Ctrl+clique, fechar, +, dividir por
  arrastar e pelo menu, trocar de lado salvando, divisória, recarregar e voltar igual,
  nota apagada some da aba, 900 px empilha.

## Fora do escopo

Duas notas editáveis ao mesmo tempo, mais de duas metades, divisão na horizontal,
abas nas outras telas, fixar aba, histórico voltar/avançar por aba.
