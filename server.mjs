import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vaultModule from './vault.cjs';
import agentModule from './agent/index.cjs';

const { Vault } = vaultModule;
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const vaultDirectory = process.env.KUROI_VAULT || join(root, 'vault');
const vault = new Vault(vaultDirectory);
const agentConfig = new agentModule.AgentConfig(vaultDirectory);
const publicFiles = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/domain.js': ['domain.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/kuroi-logo-transparent.png': ['kuroi-logo-transparent.png', 'image/png'] };
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!allowedHosts.has(request.headers.host)) return send(response, 403, { error: 'Host não permitido.' });
  if (request.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(request.headers.origin)) return send(response, 403, { error: 'Origem não permitida.' });
  try {
    if (request.url === '/api/state' && request.method === 'GET') return send(response, 200, await vault.load());
    if (request.url === '/api/trash' && request.method === 'GET') return send(response, 200, await vault.trash());
    if (request.url === '/api/restore' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'Use JSON.' });
      let bruto = ''; for await (const parte of request) { bruto += parte; if (bruto.length > 4096) return send(response, 413, { error: 'Pedido grande demais.' }); }
      return send(response, 200, await vault.restore(JSON.parse(bruto)));
    }
    if (request.url === '/api/agent-config' && request.method === 'GET') return send(response, 200, await agentConfig.load());
    if (request.url === '/api/agent-config' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'Use JSON.' });
      let bruto = ''; for await (const parte of request) { bruto += parte; if (bruto.length > 8192) return send(response, 413, { error: 'Configuração grande demais.' }); }
      return send(response, 200, await agentConfig.save(JSON.parse(bruto)));
    }
    if (request.url === '/api/state' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'Use JSON.' });
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 20 * 1024 * 1024) return send(response, 413, { error: 'Backup maior que 20 MB.' }); chunks.push(chunk); }
      return send(response, 200, await vault.save(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    }
    const file = publicFiles[request.url];
    if (request.method !== 'GET' || !file) return send(response, 404, { error: 'Não encontrado.' });
    const body = await readFile(join(root, file[0]));
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch (error) { send(response, 400, { error: error.message }); }
}).listen(port, '127.0.0.1', () => console.log(`KUROI em http://localhost:${port}`));
