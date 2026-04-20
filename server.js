const https = require('https');

const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

require('http').createServer((req, res) => {
  // CORS preflight
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

      const payload = Buffer.from(body);
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
          res.writeHead(proxyRes.statusCode, corsHeaders());
          res.end(data);
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
  if (req.url === '/') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ status: 'ok', service: 'TennisAI Proxy' }));
    return;
  }

  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ error: 'Not found' }));

}).listen(PORT, () => console.log('Proxy running on port ' + PORT));
