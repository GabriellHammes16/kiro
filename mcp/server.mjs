#!/usr/bin/env node
/**
 * Kiro MCP Server — adaptador fino sobre a Kiro Agent API.
 *
 *   pedido MCP -> validação -> Kiro Agent API -> Vault
 *
 * Nenhuma manipulação de arquivo acontece aqui. Este processo só traduz entre o
 * protocolo MCP e o toolkit, para que o mesmo núcleo sirva CLI, plugins e outros
 * clientes sem duplicação.
 *
 * Transporte: stdio. Não abre porta de rede.
 *
 * Uso:  node mcp/server.mjs [--vault <caminho>]
 *       KIRO_VAULT=<caminho> node mcp/server.mjs
 */
import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const require = createRequire(import.meta.url);
const { createKiroAgent } = require('../agent/index.cjs');

const PREFIXO = 'kiro_';

function argumentoCofre(argv) {
  const i = argv.indexOf('--vault');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

/** O cliente MCP se identifica no handshake; usamos isso como clientId da auditoria. */
function identificar(servidor) {
  const info = servidor.getClientVersion?.();
  const nome = info?.name ? String(info.name) : '';
  const id = nome.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '');
  return { clientId: id || 'mcp-client', clientName: nome || undefined };
}

const texto = valor => ({ content: [{ type: 'text', text: JSON.stringify(valor, null, 2) }] });

async function main() {
  const { toolkit, api, directory } = createKiroAgent({ vaultDirectory: argumentoCofre(process.argv) });

  const servidor = new Server(
    { name: 'kiro', version: '0.5.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolkit.list().map(f => ({
      name: `${PREFIXO}${f.name}`,
      description: f.description,
      inputSchema: f.inputSchema,
      annotations: {
        readOnlyHint: f.risk === 'read',
        destructiveHint: f.risk === 'destructive',
        idempotentHint: f.risk === 'read',
        openWorldHint: false,
      },
      _meta: { 'kiro/risk': f.risk, 'kiro/permission': f.permission },
    })),
  }));

  servidor.setRequestHandler(CallToolRequestSchema, async pedido => {
    const nome = String(pedido.params.name || '');
    const interno = nome.startsWith(PREFIXO) ? nome.slice(PREFIXO.length) : nome;
    try {
      return texto(await toolkit.call(interno, pedido.params.arguments || {}, identificar(servidor)));
    } catch (erro) {
      // Erro de ferramenta volta como resultado, não como falha de protocolo:
      // assim o modelo consegue ler a mensagem e corrigir a chamada.
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: erro.code || 'ERROR', message: erro.message, details: erro.details }, null, 2) }],
      };
    }
  });

  servidor.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'kiro://vault', name: 'Cofre Kiro', description: 'Caminho, revisão e contagens do cofre aberto.', mimeType: 'application/json' },
      { uri: 'kiro://daily', name: 'Nota diária', description: 'Nota do dia de hoje, se existir.', mimeType: 'application/json' },
    ],
  }));

  servidor.setRequestHandler(ReadResourceRequestSchema, async pedido => {
    const uri = String(pedido.params.uri || '');
    const responder = valor => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(valor, null, 2) }] });
    if (uri === 'kiro://vault') return responder(await api.describeVault());
    if (uri === 'kiro://daily') return responder(await api.getDailyNote({}));
    const nota = uri.match(/^kiro:\/\/notes\/(.+)$/);
    if (nota) return responder(await api.readNote({ id: decodeURIComponent(nota[1]) }));
    throw new Error(`Recurso desconhecido: ${uri}`);
  });

  // stdout pertence ao protocolo; qualquer aviso vai para stderr.
  process.stderr.write(`Kiro MCP ativo. Cofre: ${directory}\n`);
  await servidor.connect(new StdioServerTransport());
}

main().catch(erro => {
  process.stderr.write(`Falha ao iniciar o Kiro MCP: ${erro.message}\n`);
  process.exit(1);
});
