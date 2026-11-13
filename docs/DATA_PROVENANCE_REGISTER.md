# HEXA MAPS — Data Provenance & Licensing Register

**Verification Date:** 2026-11-13
**Core Rule:** Never assume an open-source software library makes its underlying geographic or transit data open. Every dataset ingested by HEXA MAPS must have documented provenance, licence verification, attribution propagation, and share-alike boundary management.

---

## 1. Global Geographic & Cartographic Datasets

| Dataset | Source URL | Licence | Attribution Required | Share-Alike / Copyleft Impact | Allowed Usage in HEXA |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenStreetMap (OSM)** | https://www.openstreetmap.org/copyright | **ODbL 1.0** (Open Database License) | Yes: `© OpenStreetMap contributors` visible on map UI & place details. | **Yes (Produced Works vs. Derivative Database):** Vector tiles and routing graphs derived solely from OSM are Permitted Produced Works / Derivative Databases. Mixing proprietary or incompatible closed datasets into the same PostGIS table or routing graph without separation triggers ODbL share-alike obligations. | Base vector tiles, road network (`highway=*`, `network=*`, `ref=*`), POIs, routing graphs, geocoding index. |
| **Natural Earth** | https://www.naturalearthdata.com/ | **Public Domain (CC0)** | No legal requirement (credit appreciated). | None. | Low-zoom (z0–z6) coastlines, landcover, and country/ocean labels. |
| **OSM Americana Shield Definitions** | https://github.com/osm-americana/openstreetmap-americana | **CC0 1.0 Universal** (with trademark/insignia caveats) | None required by CC0. | **Trademark Caveat:** Official highway shields in some jurisdictions contain state/crown insignia or registered marks. Standard geometric route shields (e.g., IN NH/SH, US I/US, DE Autobahn/Bundesstraße, UK M/A) are functional cartographic symbols, whereas crown/coat-of-arms crests must use simplified geometric equivalents where restricted. | Country-specific highway route shields across macOS, iOS, Android, and Web. |
| **Copernicus DEM (GLO-30) / SRTM** | https://spacedata.copernicus.eu/ | **Copernicus Open Access Licence** / Public Domain (USGS SRTM) | Yes (for Copernicus DEM). | None if attributed. | 2D hillshade raster layer and Valhalla route elevation profiles (strictly 2D; no 3D terrain mesh). |

---

## 2. Pilot Region Data Assessment: Bengaluru, India

Per the Project Charter, **Bengaluru, India** is the initial traffic and transit pilot region. Below is the verified data provenance and availability assessment as of November 2026:

| Domain | Candidate Source | Availability & Format | Licensing & Legal Status | Risk & Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **Road Network & Highway Shields** | OpenStreetMap India Community | High coverage of `NH 44`, `NH 48`, `NH 75`, `NH 275`, `SH 17`, `SH 35`, ORR, NICE Road, and arterial streets. | ODbL 1.0 | **Medium Risk:** Turn restrictions (`restriction=*`), one-ways, and lane counts (`lanes=*`) are incomplete on minor streets. Requires targeted OSM validation before claiming turn-by-turn accuracy on side streets. |
| **BMTC (Buses) Static & Realtime** | Mobility Database (MobilityData) / India Urban Data Exchange (IUDX) / Community `bmtc-gtfs` | Static GTFS `.zip` available via Mobility Database & community exports. Live vehicle telemetry exists via IUDX / state MaaS APIs, though public anonymous access has registration/rate constraints. | Government Open Data License - India (GODL-India) / IUDX Terms of Use | **High Data Gap Risk:** Do not claim live BMTC bus positions out-of-the-box until IUDX API credentials and redistribution rights for self-hosters are formally cleared. Start with verified Static GTFS schedules and mark live positions as `DATA_GAP` until feed adapter is authorized. |
| **BMRCL (Namma Metro)** | Official BMRCL Timetables / Community GTFS (`bmrcl-gtfs`) | Purple Line, Green Line, and active extensions available as static GTFS. No public unauthenticated GTFS-RT vehicle position feed is officially guaranteed. | GODL-India / Fair-use factual timetable data | **Low-Medium Risk:** Static schedule routing via OpenTripPlanner works reliably; real-time train arrival predictions must not be promised unless an official GTFS-RT feed is connected. |
| **Traffic Probes & Speeds** | HEXA Community Opt-In Probes + Synthetic Simulation (Gate 5) | Zero initial crowd density at launch. | HEXA Contributor Data License (Explicit Opt-In, Anonymized Aggregate ODbL/CC-BY-4.0 output) | **Critical Cold-Start Risk:** UI must display `NO_DATA` or `HISTORICAL` (from OSM `maxspeed` / road class heuristics labeled honestly as `ESTIMATED`) until minimum contributor threshold ($k \ge 5$ distinct probes per edge window) is met. |
| **Weather & Air Quality** | Open-Meteo / OpenAQ / CPCB India | JSON REST APIs | Open-Meteo: CC-BY-4.0 (Non-commercial free tier; self-hostable or paid API for commercial); OpenAQ: CC-BY-4.0 / source-specific. | Keep behind `WeatherProvider` and `AirQualityProvider` interfaces; cache responses server-side per tile/geohash to respect rate limits. |

---

## 3. Horizontal Rules for Data Separation (Preventing ODbL Contamination)

1. **Horizontal Layer Separation:**
   - **Layer 1 (ODbL):** OpenStreetMap road geometry, OSM POIs, and OSM-derived Valhalla routing tiles.
   - **Layer 2 (HEXA Community Database):** User reviews, ratings, uploaded photos, and business claims stored in separate PostgreSQL tables linked via external `(osm_type, osm_id)` or spatial coordinate references (`geohash` + `external_place_id`), **never** merged blindly into a closed dataset.
   - **Layer 3 (Traffic Observations):** Aggregated edge speed observations linked to `(graph_version_id, directed_edge_id)`. Because map-matching uses OSM geometry (Valhalla), HEXA will publish aggregated traffic speed extracts under an ODbL-compatible open licence while keeping raw opt-in probe telemetry ephemeral and never persisted long-term.
2. **Strict Prohibition on Proprietary Scraping:**
   - Zero use of Google Maps tiles, Google Places API data cached beyond policy, Google Street View, or scraped reviews/popular times. Automated CI checks will block any hardcoded `googleapis.com/maps` tile or scraping endpoints.
