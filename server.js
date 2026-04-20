const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

http.createServer((req, res) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // API proxy — DEVE venire prima del catch-all HTML
  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY non configurata sul server' } }));
        return;
      }

      let parsed;
      try { parsed = JSON.parse(body); }
      catch(e) {
        res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Body JSON non valido' } }));
        return;
      }

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
            res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Errore interno: ' + e.message } }));
          }
        });
      });

      proxyReq.on('error', err => {
        res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      });

      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'TennisAI', apiKey: !!process.env.ANTHROPIC_API_KEY }));
    return;
  }

  // Serve index.html per tutte le altre GET
  if (req.method === 'GET') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('index.html non trovato');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));

}).listen(PORT, () => {
  console.log('TennisAI Proxy running on port ' + PORT);
  console.log('API Key configured:', !!process.env.ANTHROPIC_API_KEY);
});
