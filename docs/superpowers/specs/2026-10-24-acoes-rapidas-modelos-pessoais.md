# Ações rápidas e modelos pessoais

## Objetivo

Executar ações sem procurar botões e criar notas a partir de modelos editáveis pelo usuário. Entregar primeiro a paleta, depois os modelos integrados a ela. Este documento define o escopo proposto para revisão; ainda não autoriza a implementação.

## Menu de ações

- Botão visível “Ações rápidas” na lateral e atalho padrão Ctrl+K, editável nas Configurações existentes. Ctrl+O continua procurando notas.
- Modal com campo “O que você quer fazer?”, até 12 resultados visíveis e lista rolável. Sem consulta, ordem fixa e previsível; sem histórico ou sugestões por frequência nesta versão.
- Pesquisa sem diferenciar acentos/maiúsculas; todos os termos digitados devem aparecer no rótulo, categoria ou nome do plugin. Priorizar início do rótulo, depois manter a ordem do catálogo. Usar `Kiro.normalize`.
- Ações iniciais: Nova nota, Nova tarefa, Novo fluxo, Captura rápida, Nota diária, Ir para nota, Configurações, Criar modelo pessoal e Criar nota por modelo. Incluir comandos de plugins ativos com identificação do plugin.
- Setas navegam, Enter executa uma vez, Esc/clicar fora fecham, Tab permanece no diálogo. Foco inicial no campo; fechamento sem executar devolve o foco anterior, quando ainda existir.
- Não abrir sobre outro modal, durante gravação de atalho, escolha de cofre, carregamento, falha ou operação ocupada. Não substituir formulários.
- Abrir ou pesquisar não salva nem altera a nota ao fundo. Executar reaproveita os fluxos existentes, incluindo bloqueios de salvamento. Revalidar plugin/comando antes do disparo. Não ativar plugins nem ampliar permissões.
- Ao atualizar instalação antiga, preservar um Ctrl+K personalizado: para a nova ação ausente nas preferências, escolher a primeira combinação livre de Ctrl+K, Ctrl+Shift+P, Ctrl+Alt+K, F1…F12. Mostrar o atalho efetivo no botão. As regras atuais continuam valendo para configurações já gravadas com a nova ação.

## Modelos pessoais

- São notas Markdown normais do cofre atual, reconhecidas pela tag exata `modelo` no **campo de tags** (comparação normalizada). Uma hashtag apenas no corpo não transforma a nota em modelo; `modelos` e `modelo/a` também não.
- “Criar modelo pessoal” abre um rascunho pelo caminho existente, com tag `modelo` e exemplo curto usando `{{title}}` e `{{date}}`. Usuário dá um título e salva como qualquer nota.
- “Criar nota por modelo” abre seleção com os três modelos embutidos e os pessoais, identificados por nome e pasta. Vazio de modelos pessoais deve explicar como criar um, sem bloquear os embutidos.
- Após selecionar, pedir o título da nova nota em um pequeno formulário (obrigatório, até 200 caracteres). Cancelar não altera o editor. Só ao confirmar executar o salvamento protetor da nota atual e abrir o novo rascunho; falha mantém a nota original e o pedido preenchido. Falha real ao salvar no cofre bloqueia nova tentativa até a recuperação existente do cofre.
- Variáveis: `{{date}}` = data local AAAA-MM-DD; `{{title}}` = título informado e aparado. Substituir em uma única passagem; variáveis desconhecidas ficam literais. Não executar JavaScript nem substituir tokens recursivamente.
- O rascunho recebe corpo, links externos e tags explícitas do modelo, retirando apenas a tag de controle `modelo`. Não copiar ID, arquivo, datas, YAML personalizado ou outras propriedades. Datas/ID novos são atribuídos pelo salvamento existente. A nota modelo permanece intacta.
- Pasta de destino: pasta da nota que estava aberta quando a ação começou, se ainda existir, senão raiz. Ao executar, reler a fonte pelo ID no cofre atual; se excluída ou deixar de ser modelo, avisar e não criar nada.
- O novo rascunho deve ficar marcado como alterado, para não perder conteúdo preenchido ao trocar de tela ou fechar. Respeitar eventual rascunho anterior e o tratamento existente de título ausente.
- O seletor “Modelo” do editor também passa a listar os pessoais, usando o mesmo catálogo. Continua aplicando ao documento atual com a confirmação existente para corpo preenchido e com Ctrl+Z funcionando; `{{title}}` usa o título atual. Se estiver vazio e o modelo usar esse token, pedir o título antes de substituir.
- Notas geradas não copiam arquivos anexos. Links são copiados como texto, sem tradução de caminhos relativos à pasta. Anexos no formato `![[Anexos/arquivo.png]]` continuam apontando para o mesmo arquivo; documentar essa limitação para caminhos relativos.

## Limites globais

- JavaScript/HTML/CSS existentes, sem dependência nova, serviço, migração do cofre ou API nova.
- Usar modal, componentes, tokens visuais e caminhos de gravação existentes. Não reestruturar `app.js` inteiro.
- Interface em PT-BR e inglês; nomes/conteúdo de modelos e plugins fornecidos pelo usuário não são traduzidos nem inseridos como HTML confiável.
- Funcionar no navegador e Electron; validar no cofre de desenvolvimento, nunca no pessoal.
- Não incluir automações, IA, marketplace, modelos de tarefas, editor visual de modelos ou analytics de uso.

## Aceitação

Uma pessoa abre Ações rápidas pelo botão ou teclado, cria um modelo sem sair do fluxo habitual de notas, encontra-o de novo e cria outra nota com título/data preenchidos. O original não muda, cancelar não perde texto, modelos não aparecem em outro cofre e comandos desativados não executam.
