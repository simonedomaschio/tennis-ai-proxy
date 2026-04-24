const https = require('https');

const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const BASE = 'https://' + HOST + '/tennis/v2/atp';

function apiGet(path) {
  const key = process.env.RAPIDAPI_KEY || '';
  const url = path.startsWith('http') ? path : BASE + path;
  return new Promise(function(resolve, reject) {
    https.get(url, {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': HOST
      },
      timeout: 15000
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, body: null, raw: data.slice(0, 300) });
        }
      });
    }).on('error', reject).on('timeout', function() {
      reject(new Error('Timeout'));
    });
  });
}

function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function findPlayer(name) {
  var key = process.env.RAPIDAPI_KEY || '';
  if (!key) return Promise.reject(new Error('RAPIDAPI_KEY non configurata'));

  var searchName = normName(name);
  var parts = searchName.split(/\s+/).filter(function(p) { return p.length > 2; });
  console.log('Searching player: ' + name);

  var page = 1;

  function tryPage() {
    return apiGet('/player?pageSize=100&pageNo=' + page).then(function(res) {
      var list = [];
      if (res.body) {
        list = Array.isArray(res.body) ? res.body :
               (res.body.data || res.body.players || res.body.results || []);
      }
      console.log('Page ' + page + ': ' + list.length + ' players, status: ' + res.status);
      if (list.length > 0) {
        console.log('First player on page: ' + (list[0] && list[0].name));
      }

      var found = null;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var pn = normName(p.name);
        if (pn === searchName) { found = p; break; }
        if (parts.length > 0 && parts.every(function(part) { return pn.includes(part); })) {
          found = p; break;
        }
      }

      if (found) {
        console.log('Found: ' + found.name + ' id: ' + found.id);
        return found;
      }
      if (list.length === 0 || page >= 8) return null;
      page++;
      return tryPage();
    });
  }

  return tryPage();
}

function getMatchStats(playerId, name, surface, season) {
  var surf = { clay:'clay', hard:'hard', grass:'grass', indoor:'hard' }[surface] || 'clay';

  return apiGet('/player/past-matches/' + playerId + '?pageSize=200&pageNo=1').then(function(res) {
    if (!res.body) {
      console.log('No past matches body, status: ' + res.status + ' raw: ' + res.raw);
      return null;
    }
    var all = Array.isArray(res.body) ? res.body : (res.body.data || res.body.matches || []);
    console.log('Total matches for ' + name + ': ' + all.length);
    if (all.length > 0) {
      console.log('Sample match keys: ' + Object.keys(all[0]).join(', '));
      console.log('Sample match: ' + JSON.stringify(all[0]).slice(0, 200));
    }

    var filtered = all.filter(function(m) {
      var ms = normName(m.surface || m.court_type || m.courtType || '');
      return ms.includes(surf);
    });

    var byYear = season ? filtered.filter(function(m) {
      var d = m.date || m.tournament_date || m.tourney_date || '';
      return d.startsWith(season.toString());
    }) : filtered;

    var use = byYear.length >= 3 ? byYear : filtered;
    console.log('Using ' + use.length + ' matches on ' + surf);
    if (use.length < 2) return null;
    return calcStats(use, name);
  });
}

function calcStats(matches, playerName) {
  var nParts = normName(playerName).split(/\s+/).filter(function(p) { return p.length > 2; });
  var f1=0, f1of=0, f1won=0, swon=0, sof=0;
  var aces=0, dfs=0, bpF=0, bpS=0, bpC=0, bpW=0, fsW=0, total=0;

  matches.forEach(function(m) {
    var wn = normName(m.winner_name || m.winner || m.w_name || '');
    var isW = nParts.some(function(p) { return wn.includes(p); });
    var pfx = isW ? 'w_' : 'l_';
    var opfx = isW ? 'l_' : 'w_';

    var svpt = parseFloat(m[pfx+'svpt'] || 0) || 0;
    if (svpt < 1) return;

    var _f1   = parseFloat(m[pfx+'1stIn']  || 0) || 0;
    var _f1w  = parseFloat(m[pfx+'1stWon'] || 0) || 0;
    var _sw   = parseFloat(m[pfx+'2ndWon'] || 0) || 0;
    var _ace  = parseFloat(m[pfx+'ace']    || 0) || 0;
    var _df   = parseFloat(m[pfx+'df']     || 0) || 0;
    var _bpF  = parseFloat(m[pfx+'bpFaced']  || 0) || 0;
    var _bpS  = parseFloat(m[pfx+'bpSaved']  || 0) || 0;
    var _bpC  = parseFloat(m[opfx+'bpFaced'] || 0) || 0;
    var _bpS2 = parseFloat(m[opfx+'bpSaved'] || 0) || 0;

    f1    += _f1;
    f1of  += svpt;
    f1won += _f1w;
    swon  += _sw;
    sof   += Math.max(0, svpt - _f1);
    aces  += _ace;
    dfs   += _df;
    bpF   += _bpF;
    bpS   += _bpS;
    bpC   += _bpC;
    bpW   += Math.max(0, _bpC - _bpS2);
    total++;

    var score = m.score || m.result || '';
    var s1 = (score.split(' ')[0] || '').replace(/\(.*\)/, '');
    var pts = s1.split('-');
    if (pts.length === 2) {
      var w = parseInt(pts[0]), l = parseInt(pts[1]);
      if (!isNaN(w) && !isNaN(l)) {
        if (isW && w > l) fsW++;
        if (!isW && l > w) fsW++;
      }
    }
  });

  if (total < 2) return null;

  return {
    first: f1of > 0  ? parseFloat((f1/f1of*100).toFixed(1))   : null,
    w1st:  f1   > 0  ? parseFloat((f1won/f1*100).toFixed(1))  : null,
    w2nd:  sof  > 0  ? parseFloat((swon/sof*100).toFixed(1))  : null,
    ace:   parseFloat((aces/total).toFixed(1)),
    df:    parseFloat((dfs/total).toFixed(1)),
    hold:  bpF  > 0  ? parseFloat((bpS/bpF*100).toFixed(1))   : null,
    ret:   bpC  > 0  ? parseFloat((bpW/bpC*100).toFixed(1))   : null,
    wfs:   total > 0 ? parseFloat((fsW/total*100).toFixed(1))  : null,
    matches: total
  };
}

var ATP_AVG = {
  clay:   { hold:78, first:61, w1st:69, w2nd:51, ret:22, ace:2.8, df:2.8, wfs:57 },
  hard:   { hold:82, first:62, w1st:72, w2nd:52, ret:20, ace:4.2, df:2.5, wfs:59 },
  grass:  { hold:85, first:63, w1st:75, w2nd:53, ret:17, ace:5.5, df:2.3, wfs:60 },
  indoor: { hold:83, first:63, w1st:73, w2nd:53, ret:19, ace:4.5, df:2.4, wfs:59 }
};

function getPlayerStats(name, surface, season) {
  if (!process.env.RAPIDAPI_KEY) {
    return Promise.resolve({ found: false, stats: null, source: 'RAPIDAPI_KEY mancante' });
  }

  return findPlayer(name).then(function(player) {
    if (!player) {
      return { found: false, stats: null, source: null };
    }
    var pid = player.id || player.playerId;

    return getMatchStats(pid, name, surface, season).then(function(stats) {
      var avg = ATP_AVG[surface] || ATP_AVG.clay;
      if (!stats) stats = {};
      Object.keys(avg).forEach(function(k) {
        if (stats[k] === null || stats[k] === undefined || isNaN(stats[k])) {
          stats[k] = avg[k];
        }
      });

      var src = stats.matches
        ? 'Matchstat API — ' + stats.matches + ' partite su ' + surface + (season ? ' ' + season : '')
        : 'Matchstat API (media ATP ' + surface + ')';

      return { found: true, stats: stats, source: src, playerName: player.name };
    });
  }).catch(function(e) {
    console.error('getPlayerStats error:', e.message);
    return { found: false, stats: null, source: e.message };
  });
}

module.exports = { getPlayerStats: getPlayerStats };
