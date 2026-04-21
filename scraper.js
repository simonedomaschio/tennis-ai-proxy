const https = require('https');

const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const BASE = `https://${HOST}/tennis/v2/atp`;

function apiGet(path) {
  const key = process.env.RAPIDAPI_KEY || '';
  const url = path.startsWith('http') ? path : BASE + path;
  return new Promise((resolve, reject) => {
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

// Normalizza nome per confronto
function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Cerca giocatore scorrendo la lista ATP
async function findPlayer(name) {
  const key = process.env.RAPIDAPI_KEY || '';
  if (!key) throw new Error('RAPIDAPI_KEY non configurata su Render');

  const searchName = normName(name);
  const parts = searchName.split(/\s+/).filter(p => p.length > 2);

  console.log(`Searching for: "${name}" (normalized: "${searchName}")`);

  // Scarica le prime 5 pagine (500 giocatori) e cerca
  for (let page = 1; page <= 5; page++) {
    const res = await apiGet(`/player?pageSize=100&pageNo=${page}`);
    
    if (!res.body) {
      console.log(`Page ${page}: no body, status ${res.status}, raw: ${res.raw}`);
      break;
    }
    
    const list = Array.isArray(res.body) ? res.body : 
                 (res.body.data || res.body.players || res.body.results || []);
    
    if (list.length === 0) break;
    
    console.log(`Page ${page}: ${list.length} players, first: ${list[0]?.name}`);

    // Match esatto o parziale
    const found = list.find(p => {
      const pn = normName(p.name);
      if (pn === searchName) return true;
      // Tutte le parti del nome cercato sono nel nome del giocatore
      return parts.length > 0 && parts.every(part => pn.includes(part));
    });

    if (found) {
      console.log(`Found: ${found.name} (id: ${found.id})`);
      return found;
    }
  }

  console.log(`Not found: ${name}`);
  return null;
}

// Calcola statistiche dai past matches
async function getStatsFromMatches(playerId, name, surface, season) {
  const surfMap = { clay: 'clay', hard: 'hard', grass: 'grass', indoor: 'hard' };
  const surf = surfMap[surface] || 'clay';
  
  const res = await apiGet(`/player/past-matches/${playerId}?pageSize=200&pageNo=1`);
  if (!res.body) return null;
  
  const all = Array.isArray(res.body) ? res.body : (res.body.data || res.body.matches || []);
  console.log(`Total past matches for ${name}: ${all.length}`);
  console.log(`Sample match:`, JSON.stringify(all[0] || {}).slice(0, 300));

  // Filtra per superficie
  const filtered = all.filter(m => {
    const mSurf = normName(m.surface || m.court_type || m.courtType || '');
    return mSurf.includes(surf) || mSurf.includes(surf === 'clay' ? 'clay' : surf);
  });
  
  // Filtra per anno se richiesto
  const byYear = season ? filtered.filter(m => {
    const d = m.date || m.tournament_date || m.tourney_date || '';
    return d.startsWith(season.toString());
  }) : filtered;

  const useMatches = byYear.length >= 3 ? byYear : filtered;
  console.log(`Matches on ${surf} (${season}): ${byYear.length}, career: ${filtered.length}, using: ${useMatches.length}`);

  if (useMatches.length < 2) return null;

  return calcStats(useMatches, name);
}

function calcStats(matches, playerName) {
  const nParts = normName(playerName).split(/\s+/).filter(p => p.length > 2);
  
  let f1=0,f1of=0,f1won=0,s1won=0,s1of=0,aces=0,dfs=0;
  let bpF=0,bpS=0,bpC=0,bpW=0,fsW=0,total=0;

  matches.forEach(m => {
    const wn = normName(m.winner_name || m.winner || m.w_name || '');
    const isW = nParts.some(p => wn.includes(p));
    const pfx = isW ? 'w_' : 'l_';
    const opfx = isW ? 'l_' : 'w_';

    const n = k => parseFloat(m[k] || m[pfx+k.replace('w_','').replace('l_','')] || 0) || 0;
    
    const svpt = parseFloat(m[pfx+'svpt'] || m.svpt || 0) || 0;
    if (svpt < 1) return; // skip matches without stats

    const _f1    = parseFloat(m[pfx+'1stIn']  || 0);
    const _f1won = parseFloat(m[pfx+'1stWon'] || 0);
    const _swon  = parseFloat(m[pfx+'2ndWon'] || 0);
    const _ace   = parseFloat(m[pfx+'ace']    || 0);
    const _df    = parseFloat(m[pfx+'df']     || 0);
    const _bpF   = parseFloat(m[pfx+'bpFaced']  || 0);
    const _bpS   = parseFloat(m[pfx+'bpSaved']  || 0);
    const _bpC   = parseFloat(m[opfx+'bpFaced'] || 0);
    const _bpS2  = parseFloat(m[opfx+'bpSaved'] || 0);

    f1   += _f1;
    f1of += svpt;
    f1won+= _f1won;
    s1won+= _swon;
    s1of += Math.max(0, svpt - _f1);
    aces += _ace;
    dfs  += _df;
    bpF  += _bpF;
    bpS  += _bpS;
    bpC  += _bpC;
    bpW  += Math.max(0, _bpC - _bpS2);
    total++;

    // first set
    const score = m.score || m.result || '';
    const s1 = score.split(' ')[0]?.replace(/\(.*\)/,'');
    if (s1) {
      const [w,l] = s1.split('-').map(Number);
      if (!isNaN(w) && !isNaN(l)) {
        if (isW && w > l) fsW++;
        if (!isW && l > w) fsW++;
      }
    }
  });

  if (total < 2) return null;

  return {
    first: f1of > 0  ? +((f1/f1of*100).toFixed(1))   : null,
    w1st:  f1   > 0  ? +((f1won/f1*100).toFixed(1))   : null,
    w2nd:  s1of > 0  ? +((s1won/s1of*100).toFixed(1)) : null,
    ace:   +((aces/total).toFixed(1)),
    df:    +((dfs/total).toFixed(1)),
    hold:  bpF  > 0  ? +((bpS/bpF*100).toFixed(1))    : null,
    ret:   bpC  > 0  ? +((bpW/bpC*100).toFixed(1))    : null,
    wfs:   total > 0 ? +((fsW/total*100).toFixed(1))   : null,
    matches: total
  };
}

// Media ATP per superficie (fallback per campi mancanti)
const ATP_AVG = {
  clay:   { hold:78, first:61, w1st:69, w2nd:51, ret:22, ace:2.8, df:2.8, wfs:57 },
  hard:   { hold:82, first:62, w1st:72, w2nd:52, ret:20, ace:4.2, df:2.5, wfs:59 },
  grass:  { hold:85, first:63, w1st:75, w2nd:53, ret:17, ace:5.5, df:2.3, wfs:60 },
  indoor: { hold:83, first:63, w1st:73, w2nd:53, ret:19, ace:4.5, df:2.4, wfs:59 },
};

async function getPlayerStats(name, surface, season) {
  if (!process.env.RAPIDAPI_KEY) {
    return { found: false, stats: null, source: 'RAPIDAPI_KEY mancante su Render' };
  }

  try {
    const player = await findPlayer(name);
    if (!player) return { found: false, stats: null, source: null };

    const pid = player.id || player.playerId;
    let stats = await getStatsFromMatches(pid, name, surface, season).catch(e => {
      console.error('Match stats error:', e.message);
      return null;
    });

    // Applica fallback ATP avg per campi mancanti
    const avg = ATP_AVG[surface] || ATP_AVG.clay;
    if (!stats) stats = {};
    Object.keys(avg).forEach(k => {
      if (stats[k] === null || stats[k] === undefined || isNaN(stats[k])) {
        stats[k] = avg[k];
      }
    });

    const src = stats.matches 
      ? `Matchstat API — ${stats.matches} partite su ${surface}${season?' '+season:''}`
      : `Matchstat API (media ATP ${surface})`;

    return { found: true, stats, source: src, playerName: player.name };

  } catch(e) {
    console.error('getPlayerStats error:', e.message);
    return { found: false, stats: null, source: e.message };
  }
}

module.exports = { getPlayerStats };
