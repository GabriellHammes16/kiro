# Kiro MCP Server

Expõe o cofre do Kiro como ferramentas MCP, para qualquer cliente compatível
com o Model Context Protocol.

O servidor é um adaptador fino: valida o pedido e chama a
[Kiro Agent API](./agent-api.md). Nenhuma manipulação de arquivo acontece nele.

## Iniciar

```bash
npm run mcp
```

Ou apontando um cofre específico:

```bash
node mcp/server.mjs --vault "C:/MeuCofre"
```

```bash
KIRO_VAULT="C:/MeuCofre" node mcp/server.mjs
```

Sem argumento, o cofre é resolvido nesta ordem: `--vault`, `KIRO_VAULT`, cofre
escolhido no aplicativo desktop, `Documentos/Kiro/vault`, cofre do projeto.

O servidor escreve `Kiro MCP ativo. Cofre: <caminho>` em **stderr** e fica
aguardando. Rodar direto no terminal é normal: um cliente MCP é quem conversa
com ele pela entrada padrão.

### A partir do aplicativo instalado

Os arquivos do Kiro ficam empacotados em `app.asar`, e um `node` externo não
consegue executar nada de dentro de um asar. Por isso a camada de agentes é
desempacotada na instalação, e o caminho a usar é o de `app.asar.unpacked`:

```
%LOCALAPPDATA%\Programs\Kiro\resources\app.asar.unpacked\mcp\server.mjs
```

```json
{
  "mcpServers": {
    "kiro": {
      "command": "node",
      "args": ["C:/Users/voce/AppData/Local/Programs/Kiro/resources/app.asar.unpacked/mcp/server.mjs"]
    }
  }
}
```

O caminho muda se você escolheu outra pasta durante a instalação. É preciso ter
o Node instalado na máquina: o Kiro não expõe o Node embutido do Electron para
processos externos.

## Transporte

**stdio apenas.** O servidor não abre porta de rede, não escuta em `0.0.0.0` e
não expõe nada na rede local. O cliente inicia o processo e conversa por
entrada/saída padrão, e o processo morre junto com o cliente.

Não há transporte HTTP. Se um dia houver, o padrão terá de ser `127.0.0.1` com
autenticação — nunca `0.0.0.0`. Expor este servidor na rede daria a quem
alcançasse a porta o mesmo poder sobre o cofre que o agente tem.

`stdout` pertence ao protocolo. Qualquer diagnóstico vai para `stderr`.

## Conectar um cliente

Formato usado pela maioria dos clientes MCP:

```json
{
  "mcpServers": {
    "kiro": {
      "command": "node",
      "args": ["C:/Projetos/Meu segundo cerebro/mcp/server.mjs"],
      "env": { "KIRO_VAULT": "C:/Users/voce/Documents/Kiro/vault" }
    }
  }
}
```

`env` é opcional: sem ele, o servidor usa o cofre aberto no aplicativo desktop.
Cada cliente tem seu próprio local para esse arquivo — consulte a documentação
do cliente que você usa.

Conectando por biblioteca, em Node:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cliente = new Client({ name: 'meu-agente', version: '1.0.0' }, { capabilities: {} });
await cliente.connect(new StdioClientTransport({
  command: 'node',
  args: ['C:/Projetos/Meu segundo cerebro/mcp/server.mjs'],
}));

const { tools } = await cliente.listTools();
const resposta = await cliente.callTool({
  name: 'kiro_create_note',
  arguments: { title: 'Ideias para o canal', folder: 'Projetos', content: 'Primeira ideia.' },
});
```

O nome que o cliente informa no handshake vira o `clientId` da auditoria. Não é
obrigatório e não muda o comportamento do Kiro: serve para você saber depois
quem fez o quê.

## Ferramentas publicadas

`kiro_create_note`, `kiro_read_note`, `kiro_update_note`, `kiro_delete_note`,
`kiro_restore_note`, `kiro_list_notes`, `kiro_search_notes`,
`kiro_list_trash`, `kiro_create_folder`, `kiro_list_folders`,
`kiro_move_note`, `kiro_get_backlinks`, `kiro_get_outgoing_links`,
`kiro_create_note_link`, `kiro_get_recent_notes`, `kiro_get_daily_note`, `kiro_get_habits`,
`kiro_add_tag`, `kiro_remove_tag`, `kiro_search_by_tag`,
`kiro_get_vault_info`, `kiro_list_fluxos`, `kiro_read_fluxo`, `kiro_create_fluxo`,
`kiro_update_fluxo`, `kiro_list_tasks`, `kiro_create_task`, `kiro_update_task`,
`kiro_set_task_status`, `kiro_delete_task`.

Schemas e níveis de risco estão em [agent-api.md](./agent-api.md).

Cada ferramenta vai com *annotations* padrão do MCP — `readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint` — e com `kiro/risk` e
`kiro/permission` no `_meta`. Um cliente pode usar isso para pedir confirmação
antes de uma ação destrutiva.

## Recursos

| URI | Conteúdo |
|---|---|
| `kiro://vault` | Caminho, revisão e contagem de notas e pastas. |
| `kiro://daily` | Nota de hoje, se existir. |
| `kiro://notes/<id>` | Uma nota pelo id. |

Só isso, de propósito: nada de despejar o cofre inteiro em contexto.

## Erros

Erro de ferramenta volta como resultado com `isError: true`, não como falha de
protocolo, para que o modelo leia a mensagem e corrija a chamada:

```json
{ "error": "PATH_TRAVERSAL", "message": "Navegar para fora do cofre não é permitido." }
```

Códigos: `INVALID_INPUT`, `INVALID_PATH`, `PATH_TRAVERSAL`, `RESERVED_PATH`,
`INVALID_NAME`, `NOTE_NOT_FOUND`, `FOLDER_NOT_FOUND`, `NOTE_EXISTS`,
`PERMISSION_DENIED`, `AGENT_DISABLED`, `UNKNOWN_TOOL`.

## Segurança

O servidor MCP não afrouxa nada: as mesmas validações de caminho, as mesmas
permissões e a mesma auditoria da Agent API valem aqui.

Vale saber:

- **Excluir vem desligado por padrão.** `kiro_delete_note` responde
  `PERMISSION_DENIED` até você ligar em **Configurações › IA e integrações**, na barra lateral.
- **Desligar tudo** é uma caixa na mesma tela: com `enabled: false`, toda
  ferramenta responde `AGENT_DISABLED`.
- **O agente só alcança o cofre.** Não existe ferramenta de arquivo genérico nem
  de execução de comando.
- **Conteúdo de nota é dado, não instrução.** Uma nota do cofre pode conter
  texto tentando comandar o agente; quem decide o que fazer com isso é o cliente
  de IA, não o Kiro.
- Rodar o servidor dá ao cliente conectado o mesmo alcance que a configuração
  permite. Conecte apenas clientes em que você confia.
