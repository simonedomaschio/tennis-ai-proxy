const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html',
        'Referer': 'https://www.ultimatetennisstatistics.com/'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    }).on('error', reject);
  });
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

// Cerca il playerId su UTS cercando per nome
async function findUTSPlayerId(name) {
  const encoded = encodeURIComponent(name);
  const url = `https://www.ultimatetennisstatistics.com/suggestPlayers?name=${encoded}&count=5`;
  try {
    const res = await fetchJson(url);
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      return res.data[0]; // { playerId, name, ... }
    }
  } catch(e) {
    console.error('UTS search error:', e.message);
  }
  return null;
}

// Prende le statistiche per superficie da UTS
async function getUTSStats(playerId, surface, season) {
  const surfMap = { clay: 'CLAY', hard: 'HARD', grass: 'GRASS', indoor: 'HARD' };
  const surf = surfMap[surface] || 'CLAY';
  
  // Endpoint statistiche UTS
  const url = `https://www.ultimatetennisstatistics.com/playerStats?playerId=${playerId}&surface=${surf}&season=${season}`;
  try {
    const res = await fetchJson(url);
    if (res.data) return res.data;
  } catch(e) {
    console.error('UTS stats error:', e.message);
  }
  return null;
}

// Mappa i campi UTS ai campi del simulatore
function mapUTSStats(utsData) {
  if (!utsData) return null;
  
  const s = utsData.statistics || utsData;
  
  // UTS usa nomi come serviceGamesWonPct, firstServePct, etc.
  const get = (obj, ...keys) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return parseFloat(obj[k]);
    }
    return null;
  };

  return {
    hold:  get(s, 'serviceGamesWonPct', 'serviceGamesWon', 'holdPct'),
    first: get(s, 'firstServePct', 'firstServeInPct', 'firstServe'),
    w1st:  get(s, 'firstServeWonPct', 'firstServePointsWonPct', 'w1stServePct'),
    w2nd:  get(s, 'secondServeWonPct', 'secondServePointsWonPct', 'w2ndServePct'),
    ret:   get(s, 'returnGamesWonPct', 'returnGamesPct', 'retPct'),
    ace:   get(s, 'acesPerMatch', 'acesPM', 'aces'),
    df:    get(s, 'doubleFaultsPerMatch', 'dfPerMatch', 'doubleFaults'),
    wfs:   get(s, 'firstSetWonPct', 'wonFirstSetPct', 'wfsPct'),
  };
}

async function getPlayerStats(name, surface, season) {
  console.log(`Searching UTS for: ${name} | ${surface} | ${season}`);
  
  // Step 1: trova playerId
  const player = await findUTSPlayerId(name);
  if (!player) {
    console.log('Player not found on UTS:', name);
    return { found: false, stats: null, source: null };
  }
  
  console.log('Found player:', player);
  
  // Step 2: prendi statistiche per anno e superficie
  const utsData = await getUTSStats(player.playerId || player.id, surface, season);
  if (!utsData) {
    // Prova senza filtro anno
    const utsDataAll = await getUTSStats(player.playerId || player.id, surface, '');
    if (utsDataAll) {
      return {
        found: true,
        stats: mapUTSStats(utsDataAll),
        source: `ultimatetennisstatistics.com (career)`,
        playerName: player.name || name
      };
    }
    return { found: false, stats: null, source: null };
  }
  
  return {
    found: true,
    stats: mapUTSStats(utsData),
    source: `ultimatetennisstatistics.com (${season})`,
    playerName: player.name || name
  };
}

module.exports = { getPlayerStats };
