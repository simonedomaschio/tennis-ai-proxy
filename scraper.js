const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000
    }, res => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// Converte nome in slug Tennis Abstract
// "Dusan Lajovic" → "DusanLajovic", "Matteo Arnaldi" → "MatteoArnaldi"
function toSlug(name) {
  return name.trim().split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

// Alcune varianti per nomi composti o invertiti
function slugVariants(name) {
  const parts = name.trim().split(/\s+/);
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const variants = [];
  // Standard: Primo Cognome
  variants.push(parts.map(cap).join(''));
  // Invertito: Cognome Primo
  if (parts.length >= 2) {
    variants.push([...parts].reverse().map(cap).join(''));
  }
  // Solo cognome (ultimo)
  variants.push(cap(parts[parts.length - 1]));
  return [...new Set(variants)];
}

// Estrae statistiche dalla pagina HTML di Tennis Abstract
function parseStats(html, surface) {
  const surfMap = { clay: 'Clay', hard: 'Hard', grass: 'Grass', indoor: 'Hard' };
  const surfLabel = surfMap[surface] || 'Clay';

  const stats = { hold: null, first: null, w1st: null, w2nd: null, ret: null, ace: null, df: null, wfs: null };

  // Tennis Abstract espone i dati come variabili JavaScript nella pagina
  // Cerca array di statistiche per superficie
  // Pattern tipico: var holdPct = [overall, hard, clay, grass, carpet]
  
  const surfIdx = { hard: 1, clay: 2, grass: 3, indoor: 1 }[surface] || 2;

  function extractArray(varName) {
    // Cerca pattern: varName = [n1, n2, n3, ...] oppure varName=[...]
    const re = new RegExp(varName + '\\s*=\\s*\\[([^\\]]+)\\]');
    const m = html.match(re);
    if (!m) return null;
    return m[1].split(',').map(v => {
      const n = parseFloat(v.trim());
      return isNaN(n) ? null : n;
    });
  }

  // Nomi variabili usati da Tennis Abstract
  const varMaps = [
    { stat: 'hold',  vars: ['holdPct', 'sHoldPct', 'hold'] },
    { stat: 'first', vars: ['firstPct', 'first', 'fsPct'] },
    { stat: 'w1st',  vars: ['w1Pct', 'w1stPct', 'fs1Pct'] },
    { stat: 'w2nd',  vars: ['w2Pct', 'w2ndPct', 'ss1Pct'] },
    { stat: 'ret',   vars: ['retHoldPct', 'rHoldPct', 'ret'] },
    { stat: 'ace',   vars: ['acePM', 'acepm', 'acePerMatch'] },
    { stat: 'df',    vars: ['dfPM', 'dfpm', 'dfPerMatch'] },
    { stat: 'wfs',   vars: ['wfsPct', 'wfs', 'wonFsPct'] },
  ];

  varMaps.forEach(({ stat, vars }) => {
    for (const v of vars) {
      const arr = extractArray(v);
      if (arr && arr[surfIdx] !== null) {
        stats[stat] = arr[surfIdx];
        break;
      }
      // Prova anche indice 0 (overall) come fallback
      if (arr && arr[0] !== null && stats[stat] === null) {
        stats[stat] = arr[0];
      }
    }
  });

  // Fallback: cerca nella tabella HTML se JS non trovato
  if (!stats.hold) {
    // Tennis Abstract ha una tabella con righe per superficie
    // Pattern: <td>Clay</td> seguito da celle con valori
    const tableRe = new RegExp(surfLabel + '[\\s\\S]{0,1000}?(\\d+\\.\\d+)%[\\s\\S]{0,100}?(\\d+\\.\\d+)%[\\s\\S]{0,100}?(\\d+\\.\\d+)%', 'i');
    const tm = html.match(tableRe);
    if (tm) {
      stats.hold  = parseFloat(tm[1]);
      stats.first = parseFloat(tm[2]);
      stats.w1st  = parseFloat(tm[3]);
    }
  }

  // Cerca valori numerici specifici nel testo della pagina come fallback finale
  if (!stats.hold) {
    // Cerca pattern come "77%" vicino a "service games won" o "hold"
    const patterns = [
      { stat: 'hold',  re: /service\s+games?\s+won[^\d]*([\d.]+)%/i },
      { stat: 'first', re: /1st\s+serve[^\d]*([\d.]+)%/i },
      { stat: 'w1st',  re: /1st\s+serve\s+points?\s+won[^\d]*([\d.]+)%/i },
      { stat: 'w2nd',  re: /2nd\s+serve\s+points?\s+won[^\d]*([\d.]+)%/i },
      { stat: 'ret',   re: /return\s+games?\s+won[^\d]*([\d.]+)%/i },
    ];
    patterns.forEach(({ stat, re }) => {
      if (!stats[stat]) {
        const m = html.match(re);
        if (m) stats[stat] = parseFloat(m[1]);
      }
    });
  }

  return stats;
}

async function getPlayerStats(name, surface) {
  const variants = slugVariants(name);
  
  for (const slug of variants) {
    const url = `https://www.tennisabstract.com/cgi-bin/player.cgi?p=${slug}`;
    try {
      console.log(`Trying TA: ${url}`);
      const res = await fetch(url);
      
      if (res.status === 200 && res.html.length > 5000 && !res.html.includes('No player found')) {
        const stats = parseStats(res.html, surface);
        const hasData = Object.values(stats).some(v => v !== null);
        
        if (hasData) {
          console.log(`Found stats for ${name}:`, stats);
          return {
            found: true,
            stats,
            source: 'Tennis Abstract',
            url
          };
        }
        // Pagina trovata ma parsing fallito - restituisci comunque
        return {
          found: true,
          stats,
          source: 'Tennis Abstract (parsing parziale)',
          url
        };
      }
    } catch(e) {
      console.log(`Error for ${slug}:`, e.message);
    }
  }

  return { found: false, stats: null, source: null };
}

module.exports = { getPlayerStats };
