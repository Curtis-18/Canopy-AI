# Canopy AI — Project Handoff Document

Date: 2026-08-12

This document is a working handoff summary for the Canopy AI project, based on direct inspection of the repository files and current implementation state. It is meant to help a future maintainer understand the architecture, responsibilities, runtime flow, and known risks in the codebase.

---

## 1. High-level summary

Canopy AI is a satellite-analytics application for forest monitoring in Uganda. It combines:

- A Python FastAPI backend for request handling, GEE-based geographic analysis, and Gemini AI assistance.
- A React + Vite frontend for map-based exploration, year comparison, time-series views, AI insights, and hotspot scanning.
- Google Earth Engine (GEE) as the primary spatial analysis engine.
- Gemini as an optional AI layer for generating natural-language insights and verifying forest-loss hotspots.
- Caching and background scanning utilities to support repeat analysis and scheduled monitoring.

The project is designed to answer questions like:

- How much healthy forest remains in a location?
- How does a forest change between years?
- Which zones look like genuine deforestation hotspots?
- What is the likely cause and recommended intervention?

The project is not a finished enterprise product; it is a feature-rich prototype / working application with operational logic but multiple configuration and robustness concerns.

---

## 2. Repository structure

Root workspace as present in the current checkout:

- .git/
- .gitignore
- .venv/
- forestwatch-backend/
- forestwatch-frontend/

### Backend structure

forestwatch-backend/
- analyzer.py
- main.py
- models.py
- scanner.py
- test_performance.py
- requirements.txt
- run.sh
- pyrightconfig.json
- hotzones_cache.json
- scan_history.json
- .env (contains local runtime secrets/config)
- venv/ (local environment copy)

### Frontend structure

forestwatch-frontend/
- index.html
- vite.config.js
- package.json
- eslint.config.js
- README.md
- public/
- src/
  - api.js
  - App.jsx
  - index.css
  - main.jsx
  - yearOptions.js
  - components/
    - AlertBadge.jsx
    - ComparePanel.jsx
    - HotZonesPanel.jsx
    - InsightPanel.jsx
    - Map.jsx
    - SatelliteComparePanel.jsx
    - StatBar.jsx
    - StatsPanel.jsx
    - TimeSeriesPanel.jsx

> Note: the repo currently includes local environment folders and a backend `.env` file, so credentials and runtime configuration are expected to be local to the checkout rather than committed as a shared template.

---

## 3. Project roles and file importance by project

## 3.1 Backend files

### forestwatch-backend/main.py
Importance: primary FastAPI application entry point.

Contains:
- FastAPI app creation
- CORS configuration
- Endpoint registration
- Data models imported from models.py
- Request/response logic for analyze, compare, insight, tiles, basemap, photo, and hotzones
- Caching and hotzones-specific file logic

Important functions and entry points:
- root()
  - Returns service metadata and route list.
- health()
  - Simple health check.
- list_forests()
  - Lists known forest names and coordinates.
- analyze_forest(req)
  - Calls the GEE analysis pipeline and returns forest stats plus alert classification.
- compare_years(req)
  - Compares two years in parallel using async executor calls.
- get_insight(req)
  - Calls Gemini to generate an AI explanation using metrics.
- get_tiles(req)
  - Returns tile layer URLs for NDVI/change/risk maps.
- get_basemap()
  - Returns a basemap tile URL for Uganda.
- get_photos(req)
  - Returns GEE natural-colour photos for A/B comparison years.
- test_tiles(...)
  - Debug helper for imagery pipeline verification.
- scan_hot_zones(req)
  - Runs a multi-step hotspot scan: cache check, WorldCover pre-filter, grid analysis, ranking, AI verification.
- _cache_key(), _read_hotzones_cache(), _write_hotzones_cache()
  - Persistent cache handling for hot zones.

Key significance:
- This file is the public API surface of the backend.
- It integrates multiple analysis methods and orchestrates them into a coherent service layer.
- It exposes the user-facing system behavior for the frontend.

### forestwatch-backend/analyzer.py
Importance: the core analytical engine and satellite processing layer.

Contains:
- Known forest definitions
- Proximity metadata for forests
- Shared constants and cache objects
- GEE initialization functions
- Planet API integration (legacy or secondary fallback)
- GEE image fetch helpers
- NDVI and risk mapping
- Core analysis logic
- Tile generation and map URL creation
- Gemini-based zone verification
- Forest naming and insight generation

Important constants:
- FORESTS
  - Dictionary of monitored forests with center coordinates.
- FOREST_PROXIMITY
  - Real-world risk context flags such as near_road and near_settlement.
- STAT_KEYS
  - Ordered keys used for building standardized response stats.
- SEVERITY_RANK
  - Severity order for ranking hot zones.
- _WC_CLASSES
  - WorldCover class mapping used to identify forest-capable land cover.

Important functions:
- init_gee()
  - Initializes Google Earth Engine safely, preventing duplicate initialization.
- _init_gemini()
  - Configures Gemini with the configured API key and known model.
- _cache_get(), _cache_set()
  - Shared in-memory cache for results and image lookups.
- get_planet_image(lat, lng, year, size, max_cloud)
  - Fetches a Planet image for a location and year, if Planet credentials exist.
- get_year_specific_photo(lat, lng, year)
  - Attempts to fetch the clearest Planet photo for a year with fallback logic.
- get_gee_photo(...)
  - Fetches natural-colour GEE satellite imagery for before/after comparison panels.
- uganda_risk_score(...)
  - Produces a weighted risk score based on cleared land, degraded land, NDVI, and forest proximity.
- score_to_alert(score)
  - Maps risk score to alert levels and human-readable warnings.
- km_to_area_ha(radius_km)
  - Converts analysis radius to hectares for display.
- _get_imagery(year, region, date_start, date_end)
  - Chooses Sentinel-2 / Landsat imagery for analysis based on year and dates.
- _mask_s2_clouds(image)
  - Masking logic for Sentinel-2 cloud contamination in analysis contexts.
- _mask_landsat_clouds(image)
  - Cloud masking for Landsat imagery.
- _mask_s2_clouds_natural(image)
  - More permissive mask for natural-colour visual output.
- _build_s2_cloudless_col(...)
  - Builds a cloudless S2 composite for basemap generation.
- _apply_cloudless_mask(img)
  - Applies the cloud mask to basemap composites.
- _get_natural_colour(...)
  - Produces a natural-colour composite suitable for AI image comparison.
- _ndvi(image, year)
  - Computes NDVI using Red and NIR bands.
- _risk_map(ndvi_image)
  - Converts NDVI into risk classes.
- analyze_location_gee(...)
  - Main spatial analysis routine.
  - Returns percentages of healthy, at risk, degraded, cleared, NDVI mean, total area.
- get_map_tiles(...)
  - Produces tile URLs for NDVI/change/risk layers.
- get_basemap_tiles()
  - Produces Uganda basemap tile URL.
- get_forest_grid(forest_name, n)
  - Produces a grid sampling layout centered on a monitored forest.
- check_worldcover_class(lat, lng, radius_km)
  - Uses ESA WorldCover to discard non-forest land cover before AI verification.
- fetch_tile_as_base64(tile_url, lat, lng, zoom)
  - Downloads GEE tile imagery and base64-encodes it for Vision analysis.
- gemini_analyze_forest_zone(...)
  - Sends baseline and comparison images to Gemini Vision and returns a structured forest-loss evaluation.
- get_natural_tile_urls(...)
  - Builds natural-colour tile URL templates for comparison requests.
- get_forest_name(lat, lng)
  - Estimates the nearest monitored forest.
- generate_forest_insight(...)
  - Generates natural-language insight text from metric data and risk context.

Key significance:
- This is the analytical core of the entire platform.
- It is the place where Earth Engine, satellite processing, risk scoring, and AI analysis are tied together.
- It also carries most of the project’s technical complexity and failure modes.

### forestwatch-backend/models.py
Importance: response and request schema definitions.

Contains classes:
- ForestStats
  - Core forest health stats.
- RiskAlert
  - Risk assessment object with level, score, message.
- ForestInsight
  - Structured output from Gemini analysis.
- AnalyzeRequest
  - Request shape for single-point analysis.
- CompareRequest
  - Request shape for year-to-year comparison.
- AnalyzeResponse
  - Response payload for /analyze.
- CompareResponse
  - Response payload for /compare.
- InsightRequest
  - Request shape for AI insight generation.
- InsightResponse
  - Response payload for /insight.
- GeminiZoneAnalysis
  - Output schema from Gemini vision classification.
- HotZonesRequest
  - Request shape for /hotzones.
- HotZone
  - Zone object after analysis.
- HotZonesResponse
  - Endpoint response payload.

Key significance:
- This file defines the API contract between frontend and backend.
- It is central to validation, serialization, and consistent behavior.

### forestwatch-backend/scanner.py
Importance: background monitoring and alerting subsystem.

Contains:
- HISTORY_PATH and _store_lock
- _read_store() and _write_store()
- HEALTHY_DROP_THRESHOLD and RISK_INCREASE_THRESHOLD
- _get_previous_scan(store, forest_name)
- run_weekly_scan()
  - Scans each forest, compares with previous recorded scan, and emits alerts when thresholds are exceeded.
- get_all_alerts()
- get_recent_alerts(days)
- _scheduler, start_scheduler(), and stop_scheduler()
  - Starts the APScheduler-based weekly scan loop and optionally stops it cleanly.

Key significance:
- This is the project’s background forest alerting system.
- It is intended for periodic surveillance of known forests rather than ad hoc user analysis.
- It is not deeply integrated into the frontend as a primary UX path, but it is a meaningful operational component.
- The current implementation uses a background scheduler to trigger an initial one-off scan immediately after startup and then scan weekly.

### forestwatch-backend/test_performance.py
Importance: simple performance verification script.

Contains:
- test_analyze(...)
- test_compare(...)
- test_tiles(...)
- main()

Key significance:
- Useful for basic endpoint timing, caching checks, and performance sanity checks.
- It is not a formal automated test suite, just a manual benchmark script.

### forestwatch-backend/requirements.txt
Importance: Python dependency manifest.

Contains:
- fastapi
- uvicorn
- python-dotenv
- numpy
- requests
- earthengine-api
- geemap
- rasterio
- google-generativeai

Key significance:
- This is the backend dependency list.
- It is minimal but incomplete for a more robust production deployment and may not include all runtime packages needed in different environments.

### forestwatch-backend/run.sh
Importance: backend startup script.

Key behavior:
- Creates or activates venv if present.
- Installs requirements.
- Checks Earth Engine module availability.
- Starts uvicorn on port 8000 with --reload.

Key significance:
- This is the quickest way to run the backend locally.
- It assumes a POSIX shell and local Python environment.

### forestwatch-backend/pyrightconfig.json
Importance: static type checking configuration.

Key significance:
- Sets Python version and disables several type checks for a permissive development environment.
- This suggests the project was built for convenience, not strict typing discipline.

---

## 3.2 Frontend files

### forestwatch-frontend/src/api.js
Importance: central frontend API layer.

Functions:
- api(method, path, body)
- analyzeForest(lat, lng, year, radius_km, opts)
- compareForest(lat, lng, year_a, year_b, radius_km, opts)
- getMapTiles(lat, lng, year_a, year_b, radius_km, opts)
- listForests()
- getPhoto(lat, lng, year_a, year_b)
- scanHotZones(forest_name, year_a, year_b, radius_km, opts)
- getInsight(data)

Key significance:
- All frontend requests funnel through this file.
- It centralizes the backend base URL and endpoint contracts.

### forestwatch-frontend/src/App.jsx
Importance: main application controller and orchestration layer.

Contains:
- App component
- UI state for selected location, active tab, year selections, map controls, drawer state, hotzones results, search suggestions, etc.
- Search behavior for monitored forests
- Data-fetch orchestration when a location is selected
- Decision logic for analyze vs compare mode
- Results-side panel logic and tab switching

Important state variables:
- selectedPoint
- analyzeResult
- compareResult
- tiles
- loading
- activeTab
- year, yearA, yearB
- radiusKm
- searchQuery and suggestions
- hotZoneSatData, hotZoneCircle

Important functions:
- handleMapClick(lat, lng)
- handleSearchSelect(forest)
- handleSearchKeyDown(e)
- useEffect for fetch orchestration when selectedPoint changes

Key significance:
- This is the primary page-level state manager for the entire app.
- It decides how the UI behaves as the user selects points, tabs, and year ranges.

### forestwatch-frontend/src/main.jsx
Importance: app bootstrap file.

Contains:
- CreateRoot render call
- Imports global CSS and Leaflet CSS
- Renders App inside StrictMode

### forestwatch-frontend/src/yearOptions.js
Importance: year-choice metadata for UI options.

Contains:
- MONTHLY_2026 entries for Jan-Feb-Mar 2026
- YEARLY entries from 2025 down to 2003
- YEAR_OPTIONS array
- resolveYear(value)

Key significance:
- Allows the frontend to resolve either a numeric year or a labeled 2026 monthly option into the correct backend query parameters.

### forestwatch-frontend/src/components/Map.jsx
Importance: map visualization and layer controls.

Contains:
- React Leaflet map rendering
- Forest label markers
- Risk color mapping
- Layer toggle logic
- Uganda GeoJSON boundary loading
- Map click handling and fly-to behavior

Important functions:
- makeForestLabel(name)
- LayerBtn({ label, active, color, disabled, onClick })
- ClickHandler({ onMapClick })
- FlyTo({ point })
- default export Map({...})

Key significance:
- This is the main visual monitoring canvas for the app.
- It toggles satellite imagery, NDVI layer, change layer, and risk layer.

### forestwatch-frontend/src/components/StatsPanel.jsx
Importance: display panel for single-location analysis results.

Contains:
- Loading and empty states
- NDVI summary, area summary, land cover percentages
- StatBar usage for healthy / at risk / degraded / cleared

Important function:
- StatsPanel({ stats, ndvi, year, loading })

Key significance:
- Main summary when the user analyzes a single point.

### forestwatch-frontend/src/components/ComparePanel.jsx
Importance: compare results panel.

Contains:
- Side-by-side comparison between baseline and compare year
- Forest loss summary and area loss calculation
- Alert badge display
- AI insight request preparation
- Before/after satellite viewer launch button

Important function:
- ComparePanel({ data, loading, onShowSat })

Key significance:
- Main UI for year-over-year forest change.

### forestwatch-frontend/src/components/TimeSeriesPanel.jsx
Importance: historical time-series trend explorer.

Contains:
- Data fetching across a range of years
- Recharts line chart for NDVI and risk trends
- Insight data packaging for more advanced AI interpretation

Important function:
- TimeSeriesPanel({ lat, lng, startYear, endYear, radiusKm, onClose })
- CustomTooltip component

Key significance:
- Useful for exploring long-term change patterns rather than only comparing two time points.

### forestwatch-frontend/src/components/InsightPanel.jsx
Importance: AI insight panel.

Contains:
- Request to /insight
- Loading/error/result states
- Buttons to generate AI analysis
- Displays summary, likely cause, recommended actions, and forecast

Important function:
- InsightPanel({ analysisData })

Key significance:
- This is the frontend integration point for Gemini-generated intelligence.

### forestwatch-frontend/src/components/AlertBadge.jsx
Importance: visual risk badge component.

Contains:
- AlertBadge({ level, score, message, large })

Key significance:
- Reused throughout the app to communicate risk.

### forestwatch-frontend/src/components/StatBar.jsx
Importance: thin progress-bar component used in stats panels.

Contains:
- StatBar({ label, pct, color, icon })

Key significance:
- Used to visually show percentage distributions.

### forestwatch-frontend/src/components/SatelliteComparePanel.jsx
Importance: before/after satellite comparison modal.

Contains:
- Hotspot detection logic from change tile output
- Photo retrieval from /photo endpoint
- Side-by-side baseline vs compare imagery panels
- Navigate-to-hotspot behavior

Important functions:
- latLngToTile(lat, lng, zoom)
- tileToLat(ty, z)
- tileToLng(tx, z)
- loadImageCORS(src)
- detectHotspot(changeTileUrl, lat, lng, radiusKm)
- SatelliteComparePanel({...})

Key significance:
- This is the visual “ground truth” comparison feature.
- It attempts to identify a local change hotspot and show satellite images for both periods.

### forestwatch-frontend/src/components/HotZonesPanel.jsx
Importance: hotspot scanning and AI verification panel.

Contains:
- Forest list and backend mapping
- Health bar displays for zone comparisons
- Severity and forest-type badges
- Zone cards
- AI scanning loader and interface for scanning a forest across a grid
- Calls scanHotZones(...) from api.js
- A mapping layer that normalizes UI forest names such as “Queen Elizabeth Nat. Park” to the backend value “Queen Elizabeth”

Important functions:
- HealthBar(...)
- SeverityChip(...)
- ForestTypeBadge(...)
- ZoneCard(...)
- ScanningLoader(...)
- default export HotZonesPanel(...)

Key significance:
- This is the strongest demonstration of the AI + GEE hotspot detection pipeline.
- It is likely the most advanced feature in the project.
- It also reveals one of the real-world mismatches between the frontend’s display names and the backend’s forest keys, which is handled via explicit mapping logic.

---

## 4. Whole system flow

## 4.1 Single-point analysis flow

1. User clicks a point on the map in the frontend.
2. App.jsx captures the lat/lng and determines whether the active mode is Analyze or Compare.
3. App.jsx calls the backend via api.js:
   - POST /analyze or POST /compare
4. Backend FastAPI route receives request.
5. main.py calls analyze_location_gee(...) in analyzer.py.
6. analyze_location_gee:
   - initializes GEE
   - builds a circular region around the point
   - selects imagery for the requested year and date window
   - computes NDVI
   - derives risk classes using thresholds
   - aggregates histogram by risk level
   - computes healthy/at-risk/degraded/cleared percentages
   - caches the result
7. main.py computes risk score using uganda_risk_score(...)
8. main.py labels the output as LOW/MEDIUM/HIGH/CRITICAL using score_to_alert(...)
9. It resolves the nearest known forest name via get_forest_name(...)
10. It returns a structured response to the frontend.
11. Frontend renders StatsPanel, AlertBadge, and any downstream compare or insight panel.

## 4.2 Compare flow

1. User selects compare mode and picks two years.
2. App.jsx calls POST /compare with lat, lng, year_a, year_b, radius_km.
3. main.py compares the two analyses in parallel using asyncio.gather and executor threads.
4. For each year, analyze_location_gee is run separately.
5. Difference is computed:
   - forest_lost_pct = healthy_pct_a - healthy_pct_b
   - forest_lost_ha = (forest_lost_pct / 100) * total_area_ha
6. Risk score is computed for the later year and translated to alert.
7. A summary sentence is generated.
8. Frontend shows ComparePanel and can optionally launch the satellite compare modal.

## 4.3 Tile-map flow

1. App.jsx requests map tiles using getMapTiles(...)
2. main.py route /tiles calls get_map_tiles(...)
3. get_map_tiles builds NDVI / change / risk layers from GEE images for two periods.
4. The result is returned as URL templates for map layers.
5. Map.jsx displays layers and toggles them for user inspection.

## 4.4 Satellite before/after flow

1. User clicks “View Before & After Satellite” from ComparePanel.
2. SatelliteComparePanel receives selectedPoint, yearA, yearB, and tiles.
3. It tries to detect a hotspot in the change tile using detectHotspot(...).
4. Once ready, it calls /photo with both years.
5. main.py calls get_gee_photo(...) twice to fetch base64 image data for each year.
6. The frontend shows the paired images side by side and allows navigation to the hotspot.

## 4.5 Hotzones scan flow

1. User selects the Hot Zones tab and chooses a forest and years.
2. Frontend calls scanHotZones(...) -> POST /hotzones.
3. main.py checks if a recent cache exists.
4. If not cached, it performs the following:
   - get_forest_grid(forest_name, n=5)
   - Sample 25 points around the forest center
   - Run analysis for each sample point for both years concurrently
   - Run WorldCover checks to discard non-forest classes
   - Build raw zone records by comparing healthy cover loss and risk
   - Rank likely hotspots by forest loss severity
   - For top zones, fetch natural-colour tile images and send them to Gemini Vision
   - Filter out false positives (non-forest, farmland, etc.)
   - Return ranked top zones with AI verdicts
5. Cache is written to hotzones_cache.json.
6. Frontend renders the most significant zones in HotZonesPanel.

## 4.6 AI insight flow

1. Frontend user invokes “Get AI Insights” in InsightPanel.
2. It serializes analysis data and submits it to POST /insight.
3. main.py calls generate_forest_insight(...)
4. generate_forest_insight uses Gemini with a prompt that includes location, year, alert, risk score, metrics, and comparison context.
5. Gemini returns structured JSON with summary, likely cause, severity explanation, recommended actions, and trend assessment.
6. Frontend displays the structured insight.

---

## 5. Key technical patterns and implementation conventions

- GEE is used as the source of truth for satellite analysis.
- The backend is service-oriented and route-driven rather than layered into formal modules beyond analyzer.py.
- Async execution is used heavily for concurrent analysis.
- There is an in-memory cache layer plus file-based caches for hotzones and scans.
- The frontend is a single-page dashboard built with React and Leaflet.
- Styling is primarily inline-react CSS rather than a formal design system or component library.
- There is a strong emphasis on user experience and polished interfaces, with loads of custom styling and animated UI states.

---

## 6. Current state of the project

At the code level, the project is in a working-but-incomplete prototype state.

### What is already working from inspection

- The backend app structure is present and wired up.
- FastAPI endpoints exist and connect to GEE logic.
- Frontend UI has major screens and controls for analyze, compare, and hotspot analysis.
- The system supports map selection, risk scoring, NDVI analysis, and AI insight requests.
- Hotzone detection includes a full multi-step flow with WorldCover filtering and Gemini AI validation.
- There are cache and alerting features for repeat analysis.
- The project has a real forest-monitoring use case and domain logic specific to Uganda.

### What is likely incomplete or fragile

- Environment configuration is not fully standardized.
- The backend assumes valid GEE credentials and Gemini API keys, but no runtime validation is enforced across all entry points.
- The code relies on hard-coded project settings such as the Earth Engine project name in init_gee().
- The project appears to have a strong demo/prototype feel rather than a production-hardened deployment pipeline.
- There is no formal automated test suite for backend correctness outside a simple performance script.
- There are limited integration tests and no CI pipeline visible in the repo structure.
- The frontend is not TypeScript-based and uses a large amount of inline styles, which makes maintainability harder.
- There is some evidence of workarounds and fallback logic everywhere (e.g., 2026 monthly date handling, Landsat/Sentinel fallback paths, Planet image fallback, and cached hotzones).

### Runtime caveat

The project likely requires the following local environment variables to work properly:
- GOOGLE_APPLICATION_CREDENTIALS
- GEMINI_API_KEY
- PLANET_API_KEY (optional depending on path used)
- ALLOWED_ORIGINS (optional, for local CORS)

Without these, some endpoints may degrade or return empty or error responses.

---

## 7. Likely issues and risks in the codebase

This section is intentionally candid and based on the code itself.

### 7.1 Earth Engine configuration risk

In analyzer.py:
- init_gee() raises if GOOGLE_APPLICATION_CREDENTIALS is missing or set to the placeholder string.
- It hardcodes ee.Initialize(project='deforestation-489507').

Issues:
- This ties the app to a specific GEE project ID.
- It is not portable across environments or deployments without manual configuration.
- If the Service Account or project is invalid, the app fails at runtime.

### 7.2 Gemini is optional but used as a core path

In analyzer.py and main.py:
- Gemini is initialized lazily.
- If the API key is missing, some functions gracefully return None or error; however, the rest of the flow may still proceed partially.

Issues:
- Feature degradation is silent in some cases.
- The user experience may look like the app works, but some AI responses are missing.
- Hot zones may be returned without AI verification if Gemini fails.

### 7.3 Caching can become stale or misleading

The project has:
- a 1-hour in-memory cache in analyzer.py
- a 7-day file-based hotzones_cache.json cache in main.py
- a scan_history.json persistence store in scanner.py

Issues:
- Data may be stale and not reflect current conditions.
- The app includes a force_refresh option, but users may not know when to use it.
- There is no strong invalidation strategy beyond TTL and file age.

### 7.4 Performance and scalability concerns

The hotzones pipeline runs many concurrent GEE tasks per forest and can become slow.
- A 5x5 grid means 25 points.
- For each point, it does analysis for two years plus WorldCover checks.
- On top of that, top zones are sent to Gemini for verification.

Issues:
- This is computationally expensive and may be slow or unstable on lower-power or shared hosting environments.
- There are no quotas, retries, or backoff strategies around GEE or Gemini calls.
- Without rate limiting or queueing, a burst of requests could trigger failures.

### 7.5 Mixed sensor/temporal logic may create edge-case errors

The project intentionally compares across satellites and date windows:
- It switches between Sentinel-2 and Landsat depending on year.
- It handles 2026 monthly composites with custom logic.
- It notes cross-sensor warnings in the UI.

Issues:
- Cross-sensor differences can produce misleading change numbers.
- Some logic for 2026 year handling is special-cased and may become brittle over time.
- This design is functional but not fully robust for long-term generalized usage.

### 7.6 Potential silent logic bugs in the hotzones and compare code

Examples seen in the code:
- Several functions rely on truthy checks, optional defaults, and fallback values rather than strict validation.
- Some equality or type assumptions may be fragile if a null value appears.
- In result handling, fallback branches often keep zones in the response even when upstream data is uncertain.

Issues:
- The app may show outputs with partially missing or incorrect metadata without strong validation errors.
- Some functions intentionally default to “keep the zone” when WorldCover or Gemini results fail, which can increase false positives.

### 7.7 Frontend state handling can be brittle

The React app uses a lot of local state with dependencies and asynchronous fetch orchestration.
- App.jsx uses selectedPoint and an effect that triggers data fetch whenever a user changes active tab or years.
- It calls several async requests in parallel and resets state aggressively.

Issues:
- State resets may cause race-like behavior during rapid UI changes.
- Some loading and result states are inferred rather than explicitly guarded.
- Complex UI conditions can be hard to debug when multiple panels are open.

### 7.8 Privacy / deployment assumptions are not built into the repo

The project uses a browser-based frontend and a local backend Uvicorn server, but repo content does not show:
- Dockerfiles
- Kubernetes manifests
- CI/CD pipeline
- deployment configs
- environment template files
- production secrets management strategy

Issues:
- It is set up like a locally-run prototype rather than a production-ready SaaS or cloud service.

### 7.9 The README is generic and not project-specific

The current README is a Vite starter README rather than a project-specific onboarding guide.

Issues:
- There is no explicit local run guide tailored to Canopy AI.
- A new engineer would have to reverse-engineer the architecture from code.

### 7.10 No true automated QA test suite

There is a test_performance.py script but no pytest suite, no CI gate, and no meaningful end-to-end verification beyond manual requests.

Issues:
- Regression risk is high when modifying geospatial logic.
- Small changes in metric thresholds or date handling could produce large downstream effects.

---

## 8. Notable implementation strengths

Despite the risks, the project has several strong elements:

- Good domain modeling for land-cover levels and risk alerts.
- Clear separation between core analysis and API surface.
- Strong visual UX for a geospatial dashboard.
- Real use of cloud-native geospatial analysis (GEE) rather than mock data.
- Good integration between technical and human-facing outputs.
- Hotzone pipeline demonstrates a thoughtful approach to reducing false positives by combining several filters before AI classification.
- Caching is used strategically to reduce repeated heavy analyses.

---

## 9. Recommended next steps for maintaining or extending the project

1. Add a real environment template and deployment documentation.
2. Move all service configuration into a clear .env.example and deployment config strategy.
3. Add automated tests around analyze, compare, and hotzones behaviors.
4. Review the GEE project ID and credentials flow for deployment portability.
5. Normalize and document the data contract between backend and frontend.
6. Introduce a small service layer or module boundaries to reduce monolithic logic in main.py and analyzer.py.
7. Add rate limiting and retry logic for GEE and Gemini calls.
8. Review hotzones heuristics and WorldCover logic for false-positive tuning.
9. Replace inline styling with a design-system approach if the app grows.
10. Create deeper documentation for the operational workflow and required environment.

---

## 10. Final assessment

The project is an ambitious and technically interesting forest intelligence application that already contains a meaningful end-to-end stack:

- geospatial analysis,
- map visualisation,
- comparison logic,
- AI support,
- background scan scheduling,
- and a user-facing dashboard.

It is best described as an advanced prototype with genuine functionality and significant potential, but not yet a hardened production deployment. The implementation is functional, visually polished, and domain-relevant, yet it depends on environment configuration, external API availability, and careful operational management to remain reliable.

The most important systems to understand if someone continues work are:
- analyzer.py
- main.py
- models.py
- App.jsx
- Map.jsx
- HotZonesPanel.jsx

These files define the actual operating core of the project.

---

## 11. Quick map of critical files

- Core backend logic: forestwatch-backend/analyzer.py
- API surface: forestwatch-backend/main.py
- Shared contracts: forestwatch-backend/models.py
- Scheduled detector: forestwatch-backend/scanner.py
- App bootstrap: forestwatch-frontend/src/App.jsx
- Map layer UI: forestwatch-frontend/src/components/Map.jsx
- Backend API wrapper: forestwatch-frontend/src/api.js
- Hotspot detection UI: forestwatch-frontend/src/components/HotZonesPanel.jsx
- Satellite comparison UI: forestwatch-frontend/src/components/SatelliteComparePanel.jsx
- AI insight UI: forestwatch-frontend/src/components/InsightPanel.jsx

---

This handoff document should be treated as a working engineering summary, not a formal design document. It is grounded in the current repository state and should be updated as the project evolves.
