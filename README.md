# AstroVitals

AstroVitals is a local dashboard prototype backed by simulated demonstration data. It is not a clinical system and does not ingest live telemetry.

The dashboard also demonstrates an explainable, rule-based health-risk score using simulated physiology, cabin CO₂/radiation, sleep, and reaction-time inputs. The packet queue and delayed-contact interaction are browser-only simulations: they do not send data to Earth or persist the queue. A NASA OSDR/GeneLab link is provided as a public-catalog reference, not as a live data integration.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The API and SQLite database run on the same machine; the database is created at `data/astrovitals.sqlite`. Set `PORT` or `DB_PATH` to override the defaults.

## API

- `GET /api/health` - server status and data mode
- `GET /api/crew` - crew roster, simulated space-health readings, and environment values
- `GET /api/crew/:id/trends?range=24H|7D|30D` - demo heart-rate and SpO2 samples
- `GET /api/alerts` - mission alerts and acknowledgement status
- `POST /api/alerts/:id/acknowledge` - acknowledge an alert (safe to repeat)
- `GET /api/crew/:id/report.csv` - download a crew member's demo report

Run the API tests with `npm test`.

All space-health values, thresholds, scores, and the reaction-time check are illustrative demo data only. They are not validated medical guidance or actual NASA/mission telemetry.
