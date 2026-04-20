const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

http.createServer((req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.writeHead(500, corsHeaders());
        res.end(JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY non configurata' } }));
        return;
      }

      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400, corsHeaders());
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
            const parsed = JSON.parse(data);
            res.writeHead(proxyRes.statusCode, corsHeaders());
            res.end(JSON.stringify(parsed));
          } catch(e) {
            res.writeHead(500, corsHeaders());
            res.end(JSON.stringify({ error: { message: 'Risposta API non valida: ' + data.slice(0,300) } }));
          }
        });
      });

      proxyReq.on('error', err => {
        res.writeHead(500, corsHeaders());
        res.end(JSON.stringify({ error: { message: err.message } }));
      });

      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ status: 'ok', service: 'TennisAI Proxy' }));
    return;
  }

  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ error: 'Not found' }));

}).listen(PORT, () => console.log('Proxy running on port ' + PORT));
