# Sincronizar um cofre e resolver conflitos

O Kiro lê arquivos locais. Se você usa Syncthing, OneDrive ou outro sincronizador,
ele atua sobre a pasta do cofre; o Kiro não controla a fila nem decide qual cópia
do serviço deve prevalecer.

## Fluxo de uso

1. Faça uma cópia de segurança da pasta inteira antes de começar.
2. Aguarde a sincronização terminar antes de abrir o mesmo cofre em outro computador.
3. Salve as notas e feche o Kiro no computador anterior antes de continuar no seguinte.
4. Sincronize o cofre inteiro, incluindo as pastas ocultas que guardam configurações,
   histórico e dados dos plugins. Mantenha também um backup separado da sincronização.
5. Confira o caminho do cofre e os plugins ativos em cada instalação. Preferências da
   janela e permissões do sistema, como notificações e microfone, podem ser diferentes.

## Quando aparecem duas cópias de uma nota

Nomes com `sync-conflict` ou indicação de cópia em conflito são sinais para comparar
os arquivos. Um nome suspeito sozinho não prova que o conteúdo divergiu; outros
tipos de conflito também podem ocorrer sem esses nomes.

1. Pare as edições nos dois computadores e aguarde entender o estado da sincronização.
2. Copie a pasta do cofre para um backup fora da pasta sincronizada.
3. Compare as duas notas em um editor de texto. Preserve trechos exclusivos das duas.
4. Escolha o arquivo que continuará sendo a nota. O campo `caderno-id` é sua identidade;
   duas notas com o mesmo ID podem impedir o carregamento seguro.
5. Guarde a outra cópia fora do cofre ativo até confirmar o resultado. Se quiser manter
   dois registros independentes dentro do cofre, crie a segunda nota pelo Kiro e copie
   o texto, para que ela receba um ID próprio.
6. Abra o Kiro, confira as notas, links e tarefas e só então retome a sincronização.

O Kiro deve apresentar os candidatos a conflito sem escolher, apagar, renomear ou
mesclar automaticamente suas cópias. Um aviso não garante que todos os conflitos
de um serviço foram encontrados.

## Histórico e dados de plugins

O `.history` é um conjunto limitado de snapshots do cofre; não substitui um backup.
Não restaure uma pasta antiga inteira por cima do cofre ativo sem antes preservar
as alterações mais recentes.

Os plugins ficam em `.kiro/plugins`. Confira seus arquivos e permissões antes de
ativar código recebido por sincronização ou de outra pessoa. Atualizações dos
plugins inclusos preservam pastas já existentes; ao atualizar manualmente, mantenha
`data.json`, que guarda o progresso de cada plugin.

Este guia não configura os serviços de sincronização nem garante edição simultânea
do mesmo arquivo em computadores diferentes.
