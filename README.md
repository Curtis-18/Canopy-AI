# Canopy AI

Canopy AI is a full-stack geospatial intelligence app for monitoring forest health and deforestation risk in Uganda. It combines Google Earth Engine for satellite analysis, Gemini AI for visual reasoning, and a React frontend for interactive exploration.

The project is designed to answer a simple but important question:

> "What is happening to forest cover in a location, how severe is the change, and where should attention be focused?"

---

## 1. What this project does

Canopy AI lets a user:

- select a location on a map,
- analyze forest condition for one year or compare two years,
- view satellite-based visual comparisons,
- inspect hotspot zones that may indicate active forest loss,
- receive AI-generated insights about likely causes and recommended actions.

In short, it is a lightweight forest monitoring and alerting platform built around remote sensing and AI.

---

## 2. Why this project matters

This system is useful for:

- environmental monitoring teams,
- conservation organizations,
- researchers studying deforestation trends,
- policy and land-management stakeholders,
- collaborators who want to understand how AI + satellite data can support land protection.

It is not just a UI demo. It is a working pipeline that connects:

- geospatial data sources,
- cloud-based analysis,
- AI interpretation,
- human-facing dashboards.

---

## 3. High-level architecture

The project is split into two main parts:

- Backend: Python + FastAPI + Earth Engine + Gemini
- Frontend: React + Vite + Leaflet

### System flow

```text
User interaction in browser
        ↓
React frontend (Map + panels)
        ↓
FastAPI backend endpoints
        ↓
Analyzer module
        ↓
Google Earth Engine + Gemini AI
        ↓
Structured stats, alerts, tiles, insights
        ↓
Frontend renders the result
```

### Core idea

1. The frontend sends a location and year selection to the backend.
2. The backend runs geospatial analysis using Earth Engine.
3. The backend computes forest health metrics and risk scores.
4. Optional AI reasoning is used for insights and hotspot validation.
5. The frontend displays the results in panels, charts, and map overlays.

---

## 4. Tech stack

### Backend

- Python
- FastAPI
- Uvicorn
- Pydantic
- Google Earth Engine
- Google Gemini API
- Python dotenv
- requests

### Frontend

- React
- Vite
- Leaflet
- Recharts

### Data sources

- Sentinel-2 / Landsat imagery via Google Earth Engine
- Optional Planet API integration (legacy / fallback path)
- Gemini vision and text reasoning for AI interpretation

---

## 5. Project structure

```text
Canopy-AI/
├── forestwatch-backend/
│   ├── analyzer.py          # Core geospatial logic and AI integration
│   ├── main.py              # FastAPI app and API endpoints
│   ├── models.py            # Request/response schemas
│   ├── scanner.py           # Background weekly scanning and alert generation
│   ├── requirements.txt    # Python dependencies
│   ├── run.sh              # Backend quick-start script
│   ├── hotzones_cache.json # Cache for hot zone scans
│   └── scan_history.json   # Persisted scan history and alerts
│
└── forestwatch-frontend/
    ├── src/
    │   ├── api.js           # Frontend API wrapper
    │   ├── App.jsx          # Main app state and page orchestration
    │   ├── components/      # UI panels and map components
    │   └── ...
    ├── package.json
    └── vite.config.js
```

---

## 6. Setup instructions

### Prerequisites

Make sure you have:

- Python 3.10+ installed
- Node.js and npm installed
- A Google Cloud / Earth Engine account
- A Gemini API key
- Optional: Planet API key if you want to use the older image endpoint path

### 6.1 Backend setup

```bash
cd forestwatch-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 6.2 Environment variables

Create a local environment file or export the required values before running the backend:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
```

If you use Earth Engine, authenticate once:

```bash
earthengine authenticate
```

> The backend currently initializes Earth Engine with a project ID in the code. If your project ID is different, update it in the relevant initialization logic in the analyzer module.

### 6.3 Run the backend

The repository includes a helper script:

```bash
./run.sh
```

Or run manually:

```bash
uvicorn main:app --reload --port 8000 --host 0.0.0.0
```

The API should then be available at:

- http://localhost:8000
- API docs: http://localhost:8000/docs

### 6.4 Frontend setup

```bash
cd ../forestwatch-frontend
npm install
npm run dev
```

Open the frontend at:

- http://localhost:5173

The frontend is configured to call the backend at http://localhost:8000.

---

## 7. How the system works end-to-end

### A. User selects a location

The frontend displays a map and allows a user to click a point or search a known forest. That location is sent to the backend with the selected year or year range.

### B. Backend analyzes satellite data

The backend calls the analyzer module, which uses Google Earth Engine to pull imagery and compute metrics such as:

- healthy forest percentage,
- at-risk percentage,
- degraded percentage,
- cleared percentage,
- NDVI mean,
- total area in hectares.

### C. Risk scoring is applied

The system converts raw geospatial stats into a forest-risk score using a custom scoring function. This score is translated into alert levels such as LOW, MEDIUM, HIGH, or CRITICAL.

### D. AI adds interpretation

When the user requests AI insights or hotspot analysis, the backend uses Gemini to assess imagery and provide a human-readable summary, likely causes, severity explanation, and recommended actions.

### E. Frontend renders the results

The UI updates different panels based on the response:

- stats summary,
- comparison charts,
- map tiles,
- before/after imagery,
- AI insight panel,
- hotspot analysis results.

---

## 8. API overview

The backend exposes a set of REST endpoints.

### Core endpoints

- GET /health
  - Health check for the service.

- GET /forests
  - Returns a list of known forest locations.

- POST /analyze
  - Analyzes a single location for one year.

- POST /compare
  - Compares a location across two years.

- POST /insight
  - Generates AI-based interpretation from the analyzed metrics.

- POST /tiles
  - Returns map visualization tiles for the frontend.

- POST /photo
  - Fetches imagery for before/after panels.

- POST /hotzones
  - Scans a forest grid, filters likely forest areas, and returns the most concerning zones.

### API behavior in practice

The frontend uses the API wrapper in the frontend source to call these endpoints. The app does not directly access Earth Engine or Gemini from the browser.

---

## 9. What each important file does

### Backend

#### [forestwatch-backend/analyzer.py](forestwatch-backend/analyzer.py)
This is the engine of the system.

It is responsible for:

- initializing Earth Engine,
- fetching Earth Engine imagery,
- computing vegetation and land cover metrics,
- creating risk scores,
- generating Gemini prompts and receiving AI responses,
- producing map tiles and satellite photo payloads.

If you want to understand the core intelligence of the project, this is the file to study first.

#### [forestwatch-backend/main.py](forestwatch-backend/main.py)
This is the API layer.

It provides the FastAPI server and handles:

- incoming requests,
- request validation,
- orchestration of analysis tasks,
- endpoint responses,
- the hot-zone scan pipeline,
- caching for repeated hotspot analysis.

This file is the communication hub between the UI and the analysis logic.

#### [forestwatch-backend/models.py](forestwatch-backend/models.py)
This file defines the Pydantic schemas for requests and responses.

It ensures that the frontend and backend share a consistent contract for data such as:

- analysis results,
- comparison payloads,
- AI insight objects,
- hotspot scan results.

#### [forestwatch-backend/scanner.py](forestwatch-backend/scanner.py)
This file implements the background monitoring system.

Its jobs include:

- scanning monitored forests regularly,
- comparing current values with prior results,
- generating alerts when significant change is detected,
- persisting scan history and alerts in JSON files.

This is the project’s “continuous monitoring” layer.

#### [forestwatch-backend/run.sh](forestwatch-backend/run.sh)
A convenience script for launching the backend in a local development environment.

### Frontend

#### [forestwatch-frontend/src/api.js](forestwatch-frontend/src/api.js)
This file centralizes API calls from the frontend. It acts as the bridge between React components and the backend endpoints.

#### [forestwatch-frontend/src/App.jsx](forestwatch-frontend/src/App.jsx)
This is the main application controller.

It manages:

- selected map points,
- current tab state,
- loading and error states,
- requests to the backend,
- state sharing between panels.

This is the main orchestrator for the UI experience.

#### [forestwatch-frontend/src/components](forestwatch-frontend/src/components)
These components render the different parts of the experience:

- map view,
- stat summaries,
- comparison panels,
- alert badges,
- insight panel,
- time-series visualizations,
- satellite comparison views,
- hotspot analysis UI.

---

## 10. How the files communicate with each other

A useful mental model is this:

1. The UI in [forestwatch-frontend/src/App.jsx](forestwatch-frontend/src/App.jsx) collects user input.
2. The API layer in [forestwatch-frontend/src/api.js](forestwatch-frontend/src/api.js) sends requests to the FastAPI backend.
3. [forestwatch-backend/main.py](forestwatch-backend/main.py) receives the request and routes it to the correct logic.
4. [forestwatch-backend/analyzer.py](forestwatch-backend/analyzer.py) performs the heavy geospatial work and AI interpretation.
5. The response is returned as structured JSON.
6. The frontend components render the data in the app.

The background monitoring workflow works a bit differently:

1. [forestwatch-backend/scanner.py](forestwatch-backend/scanner.py) runs scheduled scans.
2. It reuses the same analysis logic from the analyzer module.
3. It stores scan results and alerts in JSON files for later review.

---

## 11. Data and persistence

The backend stores historical scan results in:

- [forestwatch-backend/scan_history.json](forestwatch-backend/scan_history.json)
- [forestwatch-backend/hotzones_cache.json](forestwatch-backend/hotzones_cache.json)

These files help:

- preserve alert history,
- avoid recomputing the same hotspot scan repeatedly,
- provide a baseline for change detection.

---

## 12. What makes this project interesting

This project is a strong example of applied AI + geospatial software because it combines:

- earth observation data,
- remote sensing metrics,
- geospatial analytics,
- cloud-based AI reasoning,
- a polished interactive UI.

It demonstrates how modern software can turn raw satellite data into something operational and understandable.

---

## 13. Suggested next steps

If you want to evolve the project further, good next directions include:

- adding authentication for the dashboard,
- dockerizing the app for easier deployment,
- adding automated tests,
- improving caching and performance,
- connecting to a database instead of JSON files,
- adding more robust user-facing alert workflows,
- expanding the supported regions beyond Uganda.

---

## 14. Quick start summary

If you just want to run it locally quickly:

```bash
cd forestwatch-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY="your-key"
earthengine authenticate
uvicorn main:app --reload --port 8000 --host 0.0.0.0
```

In another terminal:

```bash
cd forestwatch-frontend
npm install
npm run dev
```

Then open the frontend and interact with the app.

---

## 15. Collaboration note

This README is meant to be both:

- a practical handoff document for collaborators, and
- a personal memory aid for future you when the codebase has been untouched for a while.

If you return to this project later, the fastest way to understand it is:

1. read the backend analyzer logic,
2. read the FastAPI entrypoint,
3. read the frontend app controller,
4. then inspect the specific panel components.

That sequence gives the clearest mental model of how the system is built.
