const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getPlayerStats } = require('./scraper');

const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

http.createServer((req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // ── STATS SCRAPER ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/stats') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { p1name, p2name, surface, season } = JSON.parse(body);
        if (!p1name || !p2name) return jsonResponse(res, 400, { error: 'Nomi mancanti' });

        console.log(`Stats request: ${p1name} vs ${p2name} | ${surface} | ${season}`);

        // Cerca entrambi i giocatori in parallelo
        const [r1, r2] = await Promise.all([
          getPlayerStats(p1name, surface, season),
          getPlayerStats(p2name, surface, season)
        ]);

        jsonResponse(res, 200, {
          p1: { name: p1name, found: r1.found, stats: r1.stats, source: r1.source },
          p2: { name: p2name, found: r2.found, stats: r2.stats, source: r2.source },
        });

      } catch(e) {
        console.error('Stats error:', e);
        jsonResponse(res, 500, { error: e.message });
      }
    });
    return;
  }

  // ── CLAUDE PROXY ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return jsonResponse(res, 500, { error: { message: 'ANTHROPIC_API_KEY non configurata' } });

      let parsed;
      try { parsed = JSON.parse(body); }
      catch(e) { return jsonResponse(res, 400, { error: { message: 'Body JSON non valido' } }); }

      const payload = Buffer.from(JSON.stringify(parsed));
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05',
          'Content-Length': payload.length,
        },
      };

      const proxyReq = https.request(options, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          try {
            res.writeHead(proxyRes.statusCode, { ...corsHeaders(), 'Content-Type': 'application/json' });
            res.end(data);
          } catch(e) {
            jsonResponse(res, 500, { error: { message: 'Errore interno' } });
          }
        });
      });
      proxyReq.on('error', err => jsonResponse(res, 500, { error: { message: err.message } }));
      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  // ── HEALTH CHECK ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, { status: 'ok', version: '10', apiKey: !!process.env.ANTHROPIC_API_KEY });
    return;
  }

  // ── STATIC HTML ────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  jsonResponse(res, 404, { error: 'Not found' });

}).listen(PORT, () => {
  console.log(`TennisAI Proxy v10 running on port ${PORT}`);
  console.log('API Key:', !!process.env.ANTHROPIC_API_KEY);
});
