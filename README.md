# TennisAI Proxy

Server proxy che gira le chiamate API Anthropic per il simulatore TennisAI.

## Deploy su Render (gratis)

1. Carica questa cartella su GitHub
2. Vai su render.com → New → Web Service
3. Collega il repository
4. Imposta la variabile d'ambiente: ANTHROPIC_API_KEY = la tua chiave API
5. Render avvia automaticamente il server

## Variabili d'ambiente richieste

- `ANTHROPIC_API_KEY` — la tua chiave API Anthropic (da console.anthropic.com)
