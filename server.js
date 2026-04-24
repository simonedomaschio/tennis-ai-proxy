var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');
var scraper = require('./scraper');

var PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(res, status, data) {
  res.writeHead(status, Object.assign({}, corsHeaders(), { 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(data));
}

http.createServer(function(req, res) {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // ── STATS via Matchstat RapidAPI ─────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/stats') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var parsed;
      try { parsed = JSON.parse(body); }
      catch(e) { return jsonResponse(res, 400, { error: 'Body non valido' }); }

      var p1name = parsed.p1name;
      var p2name = parsed.p2name;
      var surface = parsed.surface || 'clay';
      var season = parsed.season || '';

      if (!p1name || !p2name) {
        return jsonResponse(res, 400, { error: 'Nomi mancanti' });
      }

      console.log('Stats request: ' + p1name + ' vs ' + p2name + ' | ' + surface + ' | ' + season);

      Promise.all([
        scraper.getPlayerStats(p1name, surface, season),
        scraper.getPlayerStats(p2name, surface, season)
      ]).then(function(results) {
        jsonResponse(res, 200, {
          p1: { name: p1name, found: results[0].found, stats: results[0].stats, source: results[0].source },
          p2: { name: p2name, found: results[1].found, stats: results[1].stats, source: results[1].source }
        });
      }).catch(function(e) {
        jsonResponse(res, 500, { error: e.message });
      });
    });
    return;
  }

  // ── HEALTH CHECK ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, {
      status: 'ok',
      version: '21',
      rapidapi: !!process.env.RAPIDAPI_KEY
    });
    return;
  }

  // ── RAW API TEST ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url.indexOf('/api/test') === 0) {
    var key = process.env.RAPIDAPI_KEY || '';
    var qname = req.url.split('name=')[1] || 'Lajovic';
    qname = decodeURIComponent(qname);

    var testUrl = 'https://tennis-api-atp-wta-itf.p.rapidapi.com/tennis/v2/atp/player?pageSize=50&pageNo=1';
    https.get(testUrl, {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'tennis-api-atp-wta-itf.p.rapidapi.com'
      }
    }, function(r) {
      var d = '';
      r.on('data', function(c) { d += c; });
      r.on('end', function() {
        jsonResponse(res, 200, {
          url: testUrl,
          status: r.statusCode,
          hasKey: !!key,
          keyPrefix: key.slice(0, 8) + '...',
          body: d.slice(0, 1000)
        });
      });
    }).on('error', function(e) {
      jsonResponse(res, 500, { error: e.message });
    });
    return;
  }

  // ── STATIC HTML ───────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    var filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, function(err, data) {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  jsonResponse(res, 404, { error: 'Not found' });

}).listen(PORT, function() {
  console.log('TennisAI Proxy v21 running on port ' + PORT);
  console.log('RAPIDAPI_KEY configured: ' + !!process.env.RAPIDAPI_KEY);
});
