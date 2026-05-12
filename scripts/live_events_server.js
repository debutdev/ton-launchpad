const http = require('http');
const dotenv = require('dotenv');

dotenv.config();

const port = Number(process.env.PORT || process.env.LIVE_EVENTS_PORT || 8787);
const secret = process.env.LIVE_EVENTS_SECRET || '';
const clients = new Set();

function writeEvent(client, event) {
  client.write(`event: ${event.type}\n`);
  client.write(`data: ${JSON.stringify({ ...event, createdAt: event.createdAt || new Date().toISOString() })}\n\n`);
}

function broadcast(event) {
  for (const client of clients) {
    writeEvent(client, event);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => {
      clients.delete(response);
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/webhook') {
    if (secret && request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(401).end('Unauthorized');
      return;
    }

    try {
      const event = JSON.parse(await readBody(request));
      if (!event.type) throw new Error('Missing event type');
      broadcast(event);
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, clients: clients.size }));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Bad request' }));
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    });
    response.end();
    return;
  }

  response.writeHead(404).end('Not found');
});

server.listen(port, () => {
  console.log(`Live events server listening on http://localhost:${port}`);
});
