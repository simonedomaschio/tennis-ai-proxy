const https = require('https');

const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const BASE = `https://${HOST}/tennis/v2/atp`;

function apiGet(path) {
  const key = process.env.RAPIDAPI_KEY || '';
  return new Promise((resolve, reject) => {
    const url = path.startsWith('http') ? path : BASE + path;
    https.get(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null, raw: data.slice(0, 300) }); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// Cerca giocatore per nome usando l'endpoint search/misc
async function findPlayer(name) {
  const key = process.env.RAPIDAPI_KEY || '';
  if (!key) throw new Error('RAPIDAPI_KEY non configurata su Render');

  // Prova endpoint search
  const encoded = encodeURIComponent(name);
  const searchRes = await apiGet(`/misc/search?q=${encoded}`);
  console.log('Search result for', name, ':', JSON.stringify(searchRes.body)?.slice(0, 300));

  if (searchRes.status === 200 && searchRes.body) {
    const results = Array.isArray(searchRes.body) ? searchRes.body
      : (searchRes.body.data || searchRes.body.players || searchRes.body.results || []);

    // Cerca player (type=player o simile)
    const player = results.find(r =>
      (r.type === 'player' || r.entityType === 'player' || r.category === 'player' || !r.type) &&
      r.id && r.name
    );
    if (player) return player;
  }

  // Fallback: cerca nella lista giocatori per nome
  const nameLower = name.toLowerCase().trim();
  const nameParts = nameLower.split(/\s+/);

  for (let page = 1; page <= 5; page++) {
    const res = await apiGet(`/player?pageSize=200&pageNo=${page}`);
    if (!res.body || !Array.isArray(res.body) || res.body.length === 0) break;

    const found = res.body.find(p => {
      const pn = (p.name || '').toLowerCase();
      return pn === nameLower || nameParts.every(part => pn.includes(part));
    });
    if (found) {
      console.log('Found via list:', found.name, found.id);
      return found;
    }
  }

  return null;
}

// Prende surface summary
async function getSurfaceSummary(playerId) {
  const res = await apiGet(`/player/surface-summary/${playerId}`);
  console.log('Surface summary status:', res.status, ':', JSON.stringify(res.body)?.slice(0, 400));
  return res.status === 200 ? res.body : null;
}

// Prende match stats
async function getMatchStats(playerId) {
  const res = await apiGet(`/player/match-stats/${playerId}`);
  console.log('Match stats status:', res.status, ':', JSON.stringify(res.body)?.slice(0, 400));
  return res.status === 200 ? res.body : null;
}

// Prende past matches filtrati per superficie e anno
async function getPastMatches(playerId, surface, season) {
  const surfMap = { clay: 'Clay', hard: 'Hard', grass: 'Grass', indoor: 'Hard' };
  const surf = surfMap[surface] || 'Clay';
  let path = `/player/past-matches/${playerId}?pageSize=200`;
  const res = await apiGet(path);
  console.log('Past matches status:', res.status, 'count:', Array.isArray(res.body) ? res.body.length : JSON.stringify(res.body)?.slice(0,100));

  if (res.status !== 200 || !res.body) return [];
  const matches = Array.isArray(res.body) ? res.body : (res.body.data || res.body.matches || []);

  return matches.filter(m => {
    const mSurf = (m.surface || m.courtType || m.court_type || '').toLowerCase();
    const mYear = (m.date || m.tourney_date || m.match_date || '').slice(0, 4);
    const surfOk = mSurf.includes(surf.toLowerCase());
    const yearOk = !season || mYear === season.toString();
    return surfOk && yearOk;
  });
}

// Calcola statistiche dai past matches
function calcFromMatches(matches, playerName) {
  const n = playerName.toLowerCase();
  const nameParts = n.split(/\s+/);

  let firstIn=0, firstTot=0, firstWon=0, w1stOf=0;
  let secondWon=0, secondTot=0;
  let aces=0, dfs=0;
  let bpFaced=0, bpSaved=0, bpChances=0, bpWon=0;
  let fsWon=0, total=0;

  matches.forEach(m => {
    // Capisce se il giocatore è winner o loser
    const wName = (m.winner_name || m.winner || m.w_name || '').toLowerCase();
    const lName = (m.loser_name || m.loser || m.l_name || '').toLowerCase();
    const isWinner = nameParts.some(p => wName.includes(p));
    const pfx = isWinner ? 'w_' : 'l_';
    const opfx = isWinner ? 'l_' : 'w_';

    const get = (obj, ...keys) => {
      for (const k of keys) if (obj[k] !== undefined) return parseFloat(obj[k]) || 0;
      return 0;
    };

    const svpt  = get(m, pfx+'svpt', 'svpt');
    const fIn   = get(m, pfx+'1stIn', '1stIn');
    const fWon  = get(m, pfx+'1stWon', '1stWon');
    const sWon  = get(m, pfx+'2ndWon', '2ndWon');
    const ace   = get(m, pfx+'ace', 'ace');
    const df    = get(m, pfx+'df', 'df');
    const bpF   = get(m, pfx+'bpFaced', 'bpFaced');
    const bpS   = get(m, pfx+'bpSaved', 'bpSaved');
    const bpC   = get(m, opfx+'bpFaced', 'o_bpFaced');
    const bpC2  = get(m, opfx+'bpSaved', 'o_bpSaved');

    if (svpt > 0) {
      firstTot += svpt;
      firstIn  += fIn;
      firstWon += fWon;
      w1stOf   += fIn;
      secondWon += sWon;
      secondTot += Math.max(0, svpt - fIn);
      aces     += ace;
      dfs      += df;
      bpFaced  += bpF;
      bpSaved  += bpS;
      bpChances+= bpC;
      bpWon    += Math.max(0, bpC - bpC2);
      total++;

      // Win first set dal punteggio
      const score = m.score || m.result || '';
      const sets = score.split(' ');
      if (sets.length > 0) {
        const s1 = sets[0].replace(/\(.*\)/,'');
        const pts = s1.split('-');
        if (pts.length === 2) {
          const w = parseInt(pts[0]), l = parseInt(pts[1]);
          if (!isNaN(w) && !isNaN(l)) {
            if (isWinner && w > l) fsWon++;
            if (!isWinner && l > w) fsWon++;
          }
        }
      }
    }
  });

  if (total < 2) return null;

  return {
    first: firstTot > 0 ? +(firstIn/firstTot*100).toFixed(1) : null,
    w1st:  w1stOf  > 0 ? +(firstWon/w1stOf*100).toFixed(1) : null,
    w2nd:  secondTot > 0 ? +(secondWon/secondTot*100).toFixed(1) : null,
    ace:   +(aces/total).toFixed(1),
    df:    +(dfs/total).toFixed(1),
    hold:  bpFaced > 0 ? +(bpSaved/bpFaced*100*0.25+75).toFixed(1) : null,
    ret:   bpChances > 0 ? +(bpWon/bpChances*35).toFixed(1) : null,
    wfs:   total > 0 ? +(fsWon/total*100).toFixed(1) : null,
    matches: total
  };
}

// Entry point principale
async function getPlayerStats(name, surface, season) {
  const key = process.env.RAPIDAPI_KEY || '';
  if (!key) return { found: false, stats: null, source: 'RAPIDAPI_KEY mancante' };

  try {
    // 1. Trova il giocatore
    const player = await findPlayer(name);
    if (!player) {
      console.log('Player not found:', name);
      return { found: false, stats: null, source: null };
    }

    const pid = player.id || player.playerId;
    console.log(`Player found: ${player.name} (${pid})`);

    // 2. Prendi past matches filtrati per superficie e anno (più precisi)
    const matches = await getPastMatches(pid, surface, season).catch(() => []);
    console.log(`Filtered matches for ${name} on ${surface} in ${season}:`, matches.length);

    let stats = null;
    let source = '';

    if (matches.length >= 3) {
      stats = calcFromMatches(matches, name);
      source = `Matchstat API — ${matches.length} partite su ${surface} ${season}`;
    }

    // 3. Se pochi match stagionali, prova career su superficie
    if (!stats) {
      const allMatches = await getPastMatches(pid, surface, null).catch(() => []);
      console.log(`All-time matches for ${name} on ${surface}:`, allMatches.length);
      if (allMatches.length >= 5) {
        stats = calcFromMatches(allMatches, name);
        source = `Matchstat API — ${allMatches.length} partite career su ${surface}`;
      }
    }

    // 4. Fallback: surface-summary + match-stats API
    if (!stats) {
      const [surfSum, matchStats] = await Promise.all([
        getSurfaceSummary(pid).catch(() => null),
        getMatchStats(pid).catch(() => null)
      ]);

      stats = extractFromAPI(surfSum, matchStats, surface);
      source = 'Matchstat API (aggregato)';
    }

    // 5. Applica medie ATP per campi ancora mancanti
    const avg = ATP_AVG[surface] || ATP_AVG.clay;
    if (stats) {
      Object.keys(avg).forEach(k => {
        if (!stats[k] || isNaN(stats[k])) stats[k] = avg[k];
      });
    } else {
      stats = { ...avg };
      source = 'Media ATP (dati non disponibili)';
    }

    return { found: true, stats, source, playerName: player.name };

  } catch(e) {
    console.error('getPlayerStats error:', e.message);
    return { found: false, stats: null, source: e.message };
  }
}

function extractFromAPI(surfSum, matchStats, surface) {
  const stats = {};
  const surfKey = surface === 'clay' ? 'clay' : surface === 'grass' ? 'grass' : 'hard';

  // Prova surface summary
  if (surfSum) {
    const s = surfSum[surfKey] || surfSum[surfKey.charAt(0).toUpperCase()+surfKey.slice(1)] || surfSum;
    const svc = s.serviceStats || s.serve || s;
    const fi = parseFloat(svc.firstServeGm||0), fo = parseFloat(svc.firstServeOfGm||0);
    const w1 = parseFloat(svc.winningOnFirstServeGm||0), w1o = parseFloat(svc.winningOnFirstServeOfGm||fi||0);
    const w2 = parseFloat(svc.winningOnSecondServeGm||0), w2o = parseFloat(svc.winningOnSecondServeOfGm||(fo-fi)||0);
    if (fo > 0) stats.first = +((fi/fo*100).toFixed(1));
    if (w1o > 0) stats.w1st = +((w1/w1o*100).toFixed(1));
    if (w2o > 0) stats.w2nd = +((w2/w2o*100).toFixed(1));
    const ace = parseFloat(svc.acesGm||0), df = parseFloat(svc.doubleFaultsGm||0);
    const games = parseFloat(svc.gamesPlayed||svc.games||0);
    if (games > 0) { stats.ace = +((ace/games).toFixed(1)); stats.df = +((df/games).toFixed(1)); }
  }

  // Fallback match-stats
  if (!stats.first && matchStats?.data?.serviceStats) {
    const svc = matchStats.data.serviceStats;
    const fi = parseFloat(svc.firstServeGm||0), fo = parseFloat(svc.firstServeOfGm||0);
    const w1 = parseFloat(svc.winningOnFirstServeGm||0), w1o = parseFloat(svc.winningOnFirstServeOfGm||fi||0);
    const w2 = parseFloat(svc.winningOnSecondServeGm||0), w2o = parseFloat(svc.winningOnSecondServeOfGm||(fo-fi)||0);
    if (fo > 0) stats.first = +((fi/fo*100).toFixed(1));
    if (w1o > 0) stats.w1st = +((w1/w1o*100).toFixed(1));
    if (w2o > 0) stats.w2nd = +((w2/w2o*100).toFixed(1));
  }

  return Object.keys(stats).length > 0 ? stats : null;
}

const ATP_AVG = {
  clay:   { hold:78, first:61, w1st:69, w2nd:51, ret:22, ace:2.8, df:2.8, wfs:57 },
  hard:   { hold:82, first:62, w1st:72, w2nd:52, ret:20, ace:4.2, df:2.5, wfs:59 },
  grass:  { hold:85, first:63, w1st:75, w2nd:53, ret:17, ace:5.5, df:2.3, wfs:60 },
  indoor: { hold:83, first:63, w1st:73, w2nd:53, ret:19, ace:4.5, df:2.4, wfs:59 },
};

module.exports = { getPlayerStats };
