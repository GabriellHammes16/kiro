# Plano: pedidos da pesquisa com 20 usuários simulados

Origem: `docs/pesquisa-usuarios-simulada.md`. Este arquivo lista todos os pedidos, diz o que entra agora e em
que ordem, e o que fica para depois (com o motivo).

## Retomada e auditoria — 25/10/2026

O código encontrado na retomada não concluía as fases A e B. O leitor de PDF existente
mostra anexos; ele **não** implementa imprimir/exportar a nota para PDF. As marcações
abaixo registram código e integração conferidos, não aprovação por usuários reais.

| Fase | Estado atual | Entrega, evidência ou pendência |
|---|---|---|
| A1 — recorrência e lembretes | Concluída e testada | Recorrência única em UI/plug-ins/API; lembretes com app aberto; 47 testes dirigidos passaram |
| A2 — imprimir/PDF | Concluída e testada | PDF real do Electron lido pelo PDF.js: conteúdo e acentos corretos, rascunho preservado e arquivo original intacto. Anexos PDF saem como referência |
| A3 — modelos por área | Concluída e testada | Ata, aula, sessão, peça genérica, roteiro e diário de obra, em português/inglês; IDs antigos preservados |
| A4 — acessibilidade | Concluída e testada | Interface 100/115/130/150%, anúncios após salvar, lista navegável do grafo e contraste composto do Glass sobre branco; sem leitor de tela real |
| B1 — calendário mensal | Concluída e testada | Tarefas → Mês; navegação, teclado, seleção de dia e criação na data; exibe somente tarefas existentes |
| B2 — primeiros passos e foco | Concluída e testada | Tour/glossário reabrível, foco com meta, sequência após salvar e pasta/subpastas ocultas nos cartões nativos. Plugins mantêm suas visões próprias |
| B3 — histórico na interface | Concluída e testada | Listagem e prévia por ID; restaura conteúdo com revisão/backup, preservando título/pasta e outras notas. Notas antigas sem ID dependem do caminho original |
| B4 — captura e sincronização | Concluída e testada | Captura global opt-in, diagnóstico independente de load, inspeção textual antes da ativação e [guia](sincronizacao.md). Não detecta OneDrive com apenas sufixo de máquina |
| B5 — áudio e CSV | Em implementação | Anexar/tocar/gravar áudio, servir formatos seguros e converter CSV coerente em tabela renderizada |
| C1 — slides | Concluída e testada | 8 testes; saída com Esc e renderização sem injetar HTML da nota; incluso nos recursos desktop |
| C2 — relatório de foco | Concluída e testada | Hoje/7/30 dias por pasta/tag; 12 testes; últimas 200 sessões e classificação atual |

Os itens marcados **Depois** continuam fora desta implementação. A versão e o
instalador 0.23.1 foram gerados antes desta retomada e não incluem as fases ainda pendentes.

## Todos os pedidos (persona entre parênteses)

| Pedido | Personas | Decisão |
|---|---|---|
| Lembretes e notificações de tarefas, prazos e hábitos | 3, 8, 14 | Fase A1 |
| Tarefas recorrentes | 8, 12 | Fase A1 |
| Exportar nota para PDF / imprimir | 3, 4 | Fase A2 |
| Modelos prontos por área (ata, aula, sessão, peça, roteiro, diário de obra) | 3, 4, 8, 9, 17 | Fase A3 |
| Tamanho de fonte da interface | 18 | Fase A4 |
| Leitor de tela: anúncios ao marcar hábito/tarefa (aria-live) | 19 | Fase A4 |
| Lista em texto das ligações do grafo | 19 | Fase A4 |
| Contraste mínimo no Glass | 5 | Fase A4 |
| Visão de calendário (mês) | 4, 8, 12, 17 | Fase B1 |
| Primeiros passos (tour), glossário | 14, 18 | Fase B2 |
| Modo foco para escrever (tela limpa + meta de palavras) | 10 | Fase B2 |
| Comemorar sequência de hábito | 14 | Fase B2 |
| Esconder uma pasta da tela Hoje | 9 | Fase B2 |
| Histórico da nota na interface (ver e restaurar do `.history`) | 2, 10 | Fase B3 |
| Capturar de qualquer lugar (atalho global do sistema) | 7 | Fase B4 |
| Aviso de arquivo em conflito de sincronização (Syncthing/OneDrive) + guia | 13, 20 | Fase B4 |
| Áudio na nota (anexar, tocar, gravar) | 7, 16 | Fase B5 |
| Colar CSV vira tabela | 15 | Fase B5 |
| Nota vira slides | 4 | Plug-in C1 |
| Relatório de horas do Pomodoro por pasta/tag | 12 | Plug-in C2 |
| Mostrar os arquivos do plug-in antes de ativar | 20 | Fase B4 |
| Sincronização com Git (commit, histórico) | 2 | Depois |
| Celular (capturar e ler) | 11, 13, 17 | Depois: é outro app (Android/iOS ou PWA com servidor) |
| Cofre com senha / criptografia | 3, 9 | Depois: mexe no formato dos arquivos; um erro aqui perde dados. Pede desenho próprio |
| Propriedades e consultas (estilo Dataview) | 11, 15 | Depois: muda o modelo de dados da nota |
| Grifar PDF e mandar grifos para a nota | 1, 6 | Depois: camada de anotação sobre o PDF.js |
| Busca dentro dos PDFs | 6 | Depois: extrair e indexar texto dos PDFs |
| Importar do Notion | 11 | Depois |
| Citações BibTeX/Zotero | 6 | Depois |
| Glass claro | 5 | Depois |
| Exportar DOCX/ePub | 10 | Depois |
| Modo Vim | 2 | Depois |
| Flashcard com imagem e oclusão | 1 | Depois |
| Salvar página da web (web clipper) | 7 | Depois: extensão de navegador |
| Desenhar sobre a foto | 13 | Depois |
| Guias de alinhamento no fluxo | 5 | Depois |

## Como o trabalho é dividido

- **Núcleo (fases A e B):** um subagente por fase, **um de cada vez**, porque todos mexem em `app.js`,
  `styles.css` e `idiomas/en.js`. Cada um termina com `npm test` passando.
- **Plug-ins (fase C):** em paralelo com o núcleo, cada um só na própria pasta `examples/plugins/<id>/` e no
  próprio teste.
- **Regras para todos:** interface e comentários em português; todo texto novo da interface passa por `t()` e
  ganha tradução em `idiomas/en.js` (o teste `idiomas-cobertura` cobra); seguir o estilo do arquivo; sem
  dependência nova; sem commit, sem mudar versão e sem gerar instalador. A revisão, a versão e o instalador
  ficam com a sessão principal no fim.
