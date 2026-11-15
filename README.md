# AstroVitals

AstroVitals is a local, offline-first dashboard prototype backed by simulated demonstration data. It is not a clinical system and does not ingest live telemetry.

The Fleet Biometrics overview is the landing screen. Select a crew member to open their Clinical Diagnostics deep-dive, then use Fleet Overview to return to the roster.

The dashboard adapts to smaller screens. Crew cards, trends, alerts, and crew reports use the local demo API; all displayed health values remain simulated and are not clinical measurements.

The Python/FastAPI backend stores crew readings, trends, and alerts in SQLite. Its AI endpoints run an actual scikit-learn Random Forest classifier and Isolation Forest anomaly detector, trained at startup on a deterministic synthetic dataset. The models are demonstration code only: their labels, scores, thresholds, and outputs are not medically validated and must not be used for health decisions. The frontend's mission-risk score is a separate illustrative calculation. The packet queue and delayed-contact interaction remain browser-only simulations and do not send data to Earth or persist the queue. A NASA OSDR/GeneLab link is a public-catalog reference, not a live integration.

## Run locally

Requires Python 3.10 or newer. Node.js 22.13 or newer is only needed for the `npm` convenience scripts and legacy Node tests.

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

By default, the launcher tries FastAPI first and falls back to the Node.js compatibility backend if Python or its dependencies are unavailable or the Python server exits with an error. Set `ASTROVITALS_BACKEND=python` or `ASTROVITALS_BACKEND=node` to require one backend. The Node.js fallback serves the dashboard and core demo API but does not provide FastAPI's scikit-learn inference endpoints.

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

Run the FastAPI tests with `python -m pytest`. After activating the virtual environment, `npm test` runs both the FastAPI tests and legacy Node API tests.

All space-health values, model training labels, thresholds, scores, and the reaction-time check are illustrative demo data only. They are not validated medical guidance or actual NASA/mission telemetry. No real clinical or astronaut dataset was supplied, so model performance on real people or flight telemetry is unknown.
