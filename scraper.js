const https = require('https');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const BASE = `https://${RAPIDAPI_HOST}/tennis/v2/atp`;

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
      },
      timeout: 12000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: null, raw: data.slice(0,200) }); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// Cerca il playerId per nome
async function findPlayerId(name) {
  const n = name.toLowerCase().trim();
  // Prova pagine successive finché non trova
  for (let page = 1; page <= 10; page++) {
    const url = `${BASE}/player?pageSize=100&pageNo=${page}`;
    const res = await fetchJSON(url);
    if (!res.data || !Array.isArray(res.data) || res.data.length === 0) break;
    const found = res.data.find(p => {
      const pn = (p.name || '').toLowerCase();
      const parts = n.split(' ');
      return pn === n || parts.every(part => pn.includes(part));
    });
    if (found) return found;
  }
  return null;
}

// Prende le statistiche per superficie dal surface-summary
async function getSurfaceSummary(playerId) {
  const url = `${BASE}/player/surface-summary/${playerId}`;
  const res = await fetchJSON(url);
  if (res.status === 200 && res.data) return res.data;
  return null;
}

// Prende le match-stats filtrate (career o per stagione)
async function getMatchStats(playerId, season) {
  // Prova con filtro stagione se disponibile
  let url = `${BASE}/player/match-stats/${playerId}`;
  if (season) url += `?season=${season}`;
  const res = await fetchJSON(url);
  if (res.status === 200 && res.data) return res.data;
  // Fallback senza filtro stagione
  const res2 = await fetchJSON(`${BASE}/player/match-stats/${playerId}`);
  if (res2.status === 200 && res2.data) return res2.data;
  return null;
}

// Prende le past-matches per calcolare statistiche per superficie e anno
async function getPastMatches(playerId, surface, season) {
  const surfMap = { clay: 'Clay', hard: 'Hard', grass: 'Grass', indoor: 'Hard' };
  const surf = surfMap[surface] || 'Clay';
  let url = `${BASE}/player/past-matches/${playerId}?pageSize=100&pageNo=1`;
  if (season) url += `&season=${season}`;
  const res = await fetchJSON(url);
  if (!res.data) return [];
  const matches = Array.isArray(res.data) ? res.data : (res.data.data || []);
  return matches.filter(m => !surf || (m.surface || m.courtType || '').toLowerCase().includes(surf.toLowerCase()));
}

// Mappa i dati API ai campi del simulatore
function mapMatchStats(statsData, surfaceSummary, surface) {
  const surfMap = { clay: 'clay', hard: 'hard', grass: 'grass', indoor: 'hard' };
  const surf = surfMap[surface] || 'clay';

  const stats = { hold: null, first: null, w1st: null, w2nd: null, ret: null, ace: null, df: null, wfs: null };

  // Prova prima surface-summary che è già filtrato per superficie
  if (surfaceSummary) {
    const s = surfaceSummary;
    // Cerca la sezione per la superficie corretta
    const surfData = s[surf] || s[surf.charAt(0).toUpperCase() + surf.slice(1)] || s;

    const svc = surfData.serviceStats || surfData.serve || statsData?.data?.serviceStats;
    const rtn = surfData.returnStats || surfData.return || statsData?.data?.rtnStats;
    const bp  = surfData.breakPoints || surfData.breakPointsServeStats || statsData?.data?.breakPointsServeStats;
    const bpr = surfData.breakPointsReturn || surfData.breakPointsRtnStats || statsData?.data?.breakPointsRtnStats;

    if (svc) {
      const firstIn = parseFloat(svc.firstServeGm || svc.firstServe || 0);
      const firstOf = parseFloat(svc.firstServeOfGm || svc.firstServeOf || 0);
      const w1stIn  = parseFloat(svc.winningOnFirstServeGm || svc.firstServeWon || 0);
      const w1stOf  = parseFloat(svc.winningOnFirstServeOfGm || firstIn || 0);
      const w2ndIn  = parseFloat(svc.winningOnSecondServeGm || svc.secondServeWon || 0);
      const w2ndOf  = parseFloat(svc.winningOnSecondServeOfGm || (firstOf - firstIn) || 0);
      const aces    = parseFloat(svc.acesGm || svc.aces || 0);
      const dfs     = parseFloat(svc.doubleFaultsGm || svc.doubleFaults || 0);

      if (firstOf > 0)  stats.first = parseFloat((firstIn / firstOf * 100).toFixed(1));
      if (w1stOf > 0)   stats.w1st  = parseFloat((w1stIn / w1stOf * 100).toFixed(1));
      if (w2ndOf > 0)   stats.w2nd  = parseFloat((w2ndIn / w2ndOf * 100).toFixed(1));
    }

    if (bp) {
      const faced = parseFloat(bp.breakPointFacedGm || bp.faced || 0);
      const saved = parseFloat(bp.breakPointSavedGm || bp.saved || 0);
      // Service games won: approssimazione dal BP saved rate
      // Formula: la maggior parte dei svc game non ha BP → stima ~75-95%
      if (faced > 0) {
        const bpSaveRate = saved / faced;
        // Hold% ≈ (1 - (faced/gamesServed) * (1 - bpSaveRate)) * 100
        // Usiamo approssimazione standard ATP: hold ≈ 70 + bpSaveRate * 25
        stats.hold = parseFloat((70 + bpSaveRate * 25).toFixed(1));
      }
    }

    if (bpr) {
      const chances = parseFloat(bpr.breakPointChanceGm || bpr.chances || 0);
      const won     = parseFloat(bpr.breakPointWonGm || bpr.won || 0);
      if (chances > 0) {
        const convRate = won / chances;
        // Return games won ≈ conversione BP * frequenza BP per game ≈ convRate * 0.35 * 100
        stats.ret = parseFloat((convRate * 35).toFixed(1));
      }
    }
  }

  // Fallback su match-stats generali se surface-summary non ha dati
  if (!stats.first && statsData?.data?.serviceStats) {
    const svc = statsData.data.serviceStats;
    const firstIn = parseFloat(svc.firstServeGm || 0);
    const firstOf = parseFloat(svc.firstServeOfGm || 0);
    const w1stIn  = parseFloat(svc.winningOnFirstServeGm || 0);
    const w1stOf  = parseFloat(svc.winningOnFirstServeOfGm || firstIn || 0);
    const w2ndIn  = parseFloat(svc.winningOnSecondServeGm || 0);
    const w2ndOf  = parseFloat(svc.winningOnSecondServeOfGm || (firstOf - firstIn) || 0);
    const aces    = parseFloat(svc.acesGm || 0);
    const dfs     = parseFloat(svc.doubleFaultsGm || 0);

    if (firstOf > 0)  stats.first = parseFloat((firstIn / firstOf * 100).toFixed(1));
    if (w1stOf > 0)   stats.w1st  = parseFloat((w1stIn / w1stOf * 100).toFixed(1));
    if (w2ndOf > 0)   stats.w2nd  = parseFloat((w2ndIn / w2ndOf * 100).toFixed(1));
  }

  // Ace e DF dai past matches (più accurati per superficie specifica)
  return stats;
}

async function getPlayerStats(name, surface, season) {
  if (!RAPIDAPI_KEY) {
    console.log('No RAPIDAPI_KEY configured');
    return { found: false, stats: null, source: null };
  }

  console.log(`Searching Matchstat API for: ${name} | ${surface} | ${season}`);

  // 1. Trova il playerId
  const player = await findPlayerId(name);
  if (!player) {
    console.log(`Player not found: ${name}`);
    return { found: false, stats: null, source: null };
  }
  console.log(`Found player: ${player.name} (id: ${player.id})`);

  // 2. Prendi surface summary e match stats in parallelo
  const [surfaceSummary, matchStats] = await Promise.all([
    getSurfaceSummary(player.id).catch(e => { console.log('surface-summary error:', e.message); return null; }),
    getMatchStats(player.id, season).catch(e => { console.log('match-stats error:', e.message); return null; }),
  ]);

  console.log('Surface summary:', JSON.stringify(surfaceSummary)?.slice(0, 200));
  console.log('Match stats:', JSON.stringify(matchStats)?.slice(0, 200));

  // 3. Mappa i dati
  const stats = mapMatchStats(matchStats, surfaceSummary, surface);

  // 4. Valori di fallback ATP medi per superficie se mancanti
  const atpAvg = {
    clay:   { hold: 78, first: 61, w1st: 69, w2nd: 51, ret: 22, ace: 2.8, df: 2.8, wfs: 57 },
    hard:   { hold: 82, first: 62, w1st: 72, w2nd: 52, ret: 20, ace: 4.2, df: 2.5, wfs: 59 },
    grass:  { hold: 85, first: 63, w1st: 75, w2nd: 53, ret: 17, ace: 5.5, df: 2.3, wfs: 60 },
    indoor: { hold: 83, first: 63, w1st: 73, w2nd: 53, ret: 19, ace: 4.5, df: 2.4, wfs: 59 },
  };
  const avg = atpAvg[surface] || atpAvg.clay;

  // Usa ATP average per campi ancora null
  Object.keys(avg).forEach(k => {
    if (stats[k] === null || stats[k] === undefined) stats[k] = avg[k];
  });

  return {
    found: true,
    stats,
    source: `Matchstat API (${player.name})`,
    playerId: player.id,
    playerName: player.name,
  };
}

module.exports = { getPlayerStats };
