# AstroVitals

AstroVitals is a bioastronautics dashboard prototype for exploring simulated crew health telemetry. It brings crew biometrics, trends, alerts, and diagnostic views together in one responsive interface. All data is for demonstration only; the app is not a clinical system and does not ingest live telemetry.

## Deploy to Vercel

Import this repository into Vercel and deploy it with the project root as the Root Directory. No build command, output directory, or environment variables are required. Vercel serves the dashboard files and routes `/api/*` requests to the Node.js function in `api/[...route].js`.

The deployed function uses the Node.js compatibility backend and in-memory SQLite. Changes made through the demo dashboard are temporary and can reset when the function restarts or scales to another instance. The Python/scikit-learn backend is for local use and is not part of this Vercel deployment. This prototype does not use a persistent database or transmit data to an external service.

The Python/FastAPI backend stores crew readings, trends, alerts, simulated telemetry packets, and local contact drafts in SQLite. Its AI endpoints run a scikit-learn Random Forest classifier and Isolation Forest anomaly detector, trained at startup on a deterministic synthetic dataset. The Node.js fallback exposes the same API routes but uses a clearly labeled rule-based demo classifier and threshold detector instead of scikit-learn. Both implementations are demonstration code only: labels, scores, thresholds, and outputs are not medically validated and must not be used for health decisions. The frontend's mission-risk score is a separate illustrative calculation. Queued packets and delayed-contact drafts are stored locally only; no data is transmitted to Earth or any external service. A NASA OSDR/GeneLab link is a public-catalog reference, not a live integration.

## Run locally

Requires Python 3.10 or newer. Node.js 22.13 or newer is used for the local Node.js backend and `npm` scripts.

```sh
python -m venv .venv
```

Activate the virtual environment and install the Python dependencies for the full FastAPI backend:

```sh
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Start the app with:

```sh
npm start
```

The launcher automatically prefers this project's `.venv` Python when available, so activating it is optional for `npm start`.

By default, the launcher tries FastAPI first and falls back to the Node.js compatibility backend if Python or its dependencies are unavailable or the Python server exits with an error. Set `ASTROVITALS_BACKEND=python` or `ASTROVITALS_BACKEND=node` to require one backend. The fallback implements the documented API, but its rule-based demo analysis is not equivalent to the Python scikit-learn models.

The backend listens on all network interfaces so it can also be reached through container port forwarding or from other devices on your network. Open [http://127.0.0.1:3000](http://127.0.0.1:3000) on the same machine, or use the machine's network address from another device. This demo has no authentication; only run it on networks you trust. SQLite is created at `data/astrovitals.sqlite`; set `DB_PATH` to override the database location.

## API

- `GET /api/health` - server status and data mode
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

Run the FastAPI tests with `python -m pytest`. After activating the virtual environment, `npm test` runs both the FastAPI tests and legacy Node API tests.

All space-health values, model training labels, thresholds, scores, and the reaction-time check are illustrative demo data only. They are not validated medical guidance or actual NASA/mission telemetry. No real clinical or astronaut dataset was supplied, so model performance on real people or flight telemetry is unknown.
