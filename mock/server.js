import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

export async function startMockServer(port = 4177) {
  const files = new Map(await Promise.all(['index.html', 'app.js', 'style.css'].map(async name => [name, await readFile(new URL(name, import.meta.url))])));
  const polls = new Map();
  let current;
  let origin;
  function newPoll(settings = {}) {
    current = { id: randomUUID(), open: settings.open !== false, namePrompt: settings.namePrompt === true, responses: new Map() };
    polls.set(current.id, current);
    return current;
  }
  newPoll();
  const state = poll => ({ id: poll.id, open: poll.open, namePrompt: poll.namePrompt, count: poll.responses.size, url: `${origin}/poll/${poll.id}` });
  const server = createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Local host only' });
      if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Local origin only' });
      const url = new URL(req.url, origin);
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096) return send(413, { error: 'Request too large' });
        }
        body = JSON.parse(raw || '{}');
      }
      if (req.method === 'GET' && url.pathname === '/api/current') return send(200, state(current));
      if (req.method === 'POST' && url.pathname === '/api/new') return send(200, state(newPoll(body)));
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        if (typeof body.open === 'boolean') current.open = body.open;
        if (typeof body.namePrompt === 'boolean') current.namePrompt = body.namePrompt;
        return send(200, state(current));
      }
      const match = url.pathname.match(/^\/api\/poll\/([a-f0-9-]+)(\/response|\/qr.png)?$/);
      if (match) {
        const poll = polls.get(match[1]);
        if (!poll) return send(404, { error: 'Poll not found. Create a new poll.' });
        if (req.method === 'GET' && match[2] === '/qr.png') {
          return send(200, await QRCode.toBuffer(state(poll).url, { width: 360, margin: 4, errorCorrectionLevel: 'M' }), 'image/png');
        }
        if (req.method === 'GET' && !match[2]) return send(200, { ...state(poll), responded: poll.responses.has(url.searchParams.get('participant')) });
        if (req.method === 'POST' && match[2] === '/response') {
          if (!poll.open) return send(409, { error: 'Poll is paused' });
          if (typeof body.participant !== 'string' || !body.participant || body.participant.length > 100 || body.answer !== 'Yes') return send(400, { error: 'Invalid response' });
          poll.responses.set(body.participant, { answer: 'Yes', timestamp: new Date().toISOString() });
          return send(200, { ...state(poll), responded: true });
        }
      }
      if (req.method === 'GET' && (url.pathname === '/' || /^\/poll\/[a-f0-9-]+$/.test(url.pathname))) return send(200, files.get('index.html'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && ['/app.js', '/style.css'].includes(url.pathname)) return send(200, files.get(url.pathname.slice(1)), url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
      send(404, { error: 'Not found' });
    } catch (error) { send(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let instance;
  for (let port = 4177; port < 4197; port++) {
    try { instance = await startMockServer(port); break; }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  if (!instance) throw new Error('No available mock server port between 4177 and 4196.');
  await writeFile(new URL('../.mock-server.json', import.meta.url), JSON.stringify({ origin: instance.origin }));
  console.log(`Mock attendance poll: ${instance.origin}\nIn another terminal, run npm run mock-monitor. Ctrl+C stops this server.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void instance.close(); });
}
