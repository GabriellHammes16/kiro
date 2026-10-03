# Kiro

Antes de sair lendo arquivos para entender o projeto, consulte o grafo de
conhecimento em `graphify-out/` — ele já mapeia os 125 arquivos do repositório
(1778 nós, 3498 arestas, 133 comunidades; `vendor/` fica de fora — ver `.graphifyignore`).

- Pergunta sobre arquitetura, quem chama o quê, onde mora uma decisão:
  `graphify query "<pergunta>"`
- Caminho entre dois conceitos: `graphify path "A" "B"`
- Explicar um nó: `graphify explain "<nó>"`
- Visão geral em texto: `graphify-out/GRAPH_REPORT.md`
- Mapa visual: `graphify-out/graph.html`

Depois de mudanças grandes no código, atualize o grafo: `/graphify . --update`
