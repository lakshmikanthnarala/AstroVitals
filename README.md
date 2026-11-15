# AstroVitals

AstroVitals is a bioastronautics dashboard prototype for exploring simulated crew health telemetry. It brings crew biometrics, trends, alerts, and diagnostic views together in one responsive interface. All data is for demonstration only; the app is not a clinical system and does not ingest live telemetry.

## Deploy to Vercel

Import this repository into Vercel and deploy it with the project root as the Root Directory. No build command, output directory, or environment variables are required. Vercel serves the dashboard files and routes `/api/*` requests to the Node.js function in `api/[...route].js`.

The deployed function uses in-memory SQLite. Changes made through the demo dashboard are temporary and can reset when the function restarts or scales to another instance. This prototype does not use a persistent database or transmit data to an external service.

The Node.js API stores crew readings, trends, alerts, simulated telemetry packets, and local contact drafts in SQLite. Its AI endpoints use a rule-based demo classifier and threshold detector. All labels, scores, and thresholds are illustrative, are not medically validated, and must not be used for health decisions. The frontend's mission-risk score is a separate illustrative calculation. Queued packets and delayed-contact drafts are stored locally only; no data is transmitted to Earth or any external service. The dashboard also includes a small, locally bundled CRP concentration subset from NASA OSDR study OSD-575; it is separate from simulated crew telemetry and is not mapped to the fictional crew profiles.

## Run locally

Requires Node.js 22.13 or newer.

Start the app with:

```sh
npm start
```

`npm start` runs the Node.js API directly; no Python or FastAPI entrypoint is required.

The backend listens on all network interfaces so it can also be reached through container port forwarding or from other devices on your network. Open [http://127.0.0.1:3000](http://127.0.0.1:3000) on the same machine, or use the machine's network address from another device. This demo has no authentication; only run it on networks you trust. SQLite is created at `data/astrovitals.sqlite`; set `DB_PATH` to override the database location.

## API

- `GET /api/health` - server status and data mode
- `GET /api/studies/osd-575` - locally bundled serum CRP sample measurements from NASA OSD-575
- `GET /api/ai/status` - model names, versions, and synthetic training-set size
- `POST /api/ai/analyze` - run model inference on a validated demo telemetry snapshot
- `GET /api/ai/scenarios` or `/api/scenarios` - representative scenario catalog
- `GET /api/crew` - crew roster, model outputs, environment, and status
- `POST /api/crew` - add a person with simulated vital readings to local SQLite
- `GET /api/crew/:id/trends?range=24H|7D|30D` - demo heart-rate and SpO2 samples
- `GET /api/crew/:id/scenario` - model inference and decision-engine output for a crew member
- `GET /api/alerts` - mission alerts and acknowledgement status
- `POST /api/alerts/:id/acknowledge` - acknowledge an alert (safe to repeat)
- `GET /api/crew/:id/report.csv` - download a crew member's demo report
- `GET /api/packets` and `POST /api/packets` - list queued demo packets or save a crew health snapshot locally
- `POST /api/packets/:id/acknowledge` - mark a packet reviewed locally (safe to repeat)
- `GET /api/contact-requests` and `POST /api/contact-requests` - list or schedule a local-only contact draft (`crewId`, `message`, optional `delayMinutes` from 0 to 1440)
- `POST /api/contact-requests/:id/cancel` - cancel a local contact draft (safe to repeat)

Run the API tests with `npm test`.

The crew vitals, model training labels, thresholds, scores, and reaction-time check are illustrative demo data only. OSD-575 contains serum assay measurements, not heart rate or oxygen saturation, and is not used to replace or infer those vitals. Its displayed CRP subset represents coded study participants and sampling timepoints; it is research data, not a clinical assessment. See the [NASA OSDR OSD-575 study page](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) for the full dataset and study context. Model performance on real people or flight telemetry is unknown.
