# HEXA MAPS — Gate-by-Gate Implementation Plan

**Status:** Draft for Approval
**Release Sequence:** Phase 1: macOS → Phase 2: iOS → Phase 3: Android → Phase 4: Self-Hostable Web

---

## Gate Overview & Exit Criteria

### GATE 0 — Repository and Research Audit (CURRENT)
- **Deliverables:**
  - Repository audit (`REPOSITORY_AUDIT.md`)
  - Verified upstream dependency register (`DEPENDENCY_REGISTER.md`)
  - Data provenance & Bengaluru pilot register (`DATA_PROVENANCE_REGISTER.md`)
  - Modular monolith + engine architecture proposal (`ARCHITECTURE_PROPOSAL.md`)
  - Risk register (`RISK_REGISTER.md`) & Threat model (`SECURITY_THREAT_MODEL.md`)
  - Spike plans (`MACOS_RENDERER_SPIKE.md`, `VALHALLA_TRAFFIC_SPIKE.md`)
  - Initial ADRs (`0001` through `0006`)
- **Exit Criteria:** User reviews and approves Gate 0 documents and resolves open architectural decisions.

---

### GATE 1 — Architecture Decisions & Proof of Concepts (Spikes)
- **Deliverables:**
  - **Spike 1 (`MACOS_RENDERER_SPIKE`):** Benchmark harness comparing Candidate A (MapLibre Native macOS AppKit/Metal) vs. Candidate B (MapLibre GL JS v6.18 inside native SwiftUI `WKWebView` with `WKURLSchemeHandler` local tile streaming). Finalize ADR-0001.
  - **Spike 2 (`VALHALLA_TRAFFIC_SPIKE`):** Dockerized Valhalla `3.6.3+` build on a Bengaluru `.osm.pbf` extract; custom C++/Python `traffic.tar` binary writer; verification that injected edge speeds change Valhalla route choice and ETA without restarting `valhalla_service`.
  - **Spike 3 (`packages/highway-shields` PoC):** Render verified highway shields for India (`NH 44`, `NH 48`, `SH 35`), US (`I-95`, `US 66`), UK (`M25`, `A1`), and Germany (`A7`, `B27`) with nine-slice sprite metadata and unknown-network fallback.
  - Local Docker Compose stack (`infrastructure/docker-compose.yml`) bringing up PostGIS, Martin, Photon, Valhalla, NATS, and SeaweedFS.
- **Exit Criteria:** All three spikes pass quantitative benchmarks and automated tests in CI.

---

### GATE 2 — macOS Map Foundation (Phase 1 Core)
- **Deliverables:**
  - Native macOS app (`apps/macos`) with SwiftUI chrome (sidebar, floating search bar, layer switcher, scale bar, compass, attribution sheet, keyboard shortcuts).
  - Planetiler regional build script (`scripts/build-tiles.sh`) producing Bengaluru + global overview `.pmtiles`.
  - HEXA 2D Light & Dark map styles with integrated `packages/highway-shields`.
  - Offline region download manager on macOS (HTTP Range resumable download, SHA-256 verification, local PMTiles serving).
- **Exit Criteria:** 60 fps 2D pan/zoom/rotate on Apple Silicon, full keyboard navigation, verified country highway shields, zero proprietary API calls, passes accessibility audit (VoiceOver).

---

### GATE 3 — Search and Places
- **Deliverables:**
  - `search`, `geocoding`, and `places` modules in `services/api`.
  - Self-hosted Photon `1.3.0` + PostGIS spatial POI index integration.
  - Autocomplete, forward geocoding, reverse geocoding (right-click "What's here?" on macOS), and category discovery (restaurants, hospitals, EV chargers, fuel, ATMs, metro/bus stops).
  - Place detail inspector showing OSM metadata, parsed `opening_hours`, source attribution, and "Last verified" badge.
- **Exit Criteria:** Sub-100ms p95 local search latency; works without user login; offline SQLite FTS5 search fallback works when disconnected.

---

### GATE 4 — Routing and Navigation
- **Deliverables:**
  - `routing` and `navigation` modules in `services/api` wrapping Valhalla (`auto`, `bicycle`, `pedestrian`, hiking costing, avoid tolls/highways/ferries).
  - Multi-stop routing, alternative route ribbons on the 2D map, elevation profile chart (2D chart using DEM data), and turn-by-turn maneuver list.
  - Navigation state machine (`packages/navigation-core` / Swift) with off-route detection, automatic rerouting, speed limit display, and macOS `AVSpeechSynthesizer` voice guidance.
- **Exit Criteria:** Geospatial routing regression test suite passing across 50+ test cases in Bengaluru and international reference cities; offline routing working against locally downloaded Valhalla tile packages.

---

### GATE 5 — Synthetic Live-Traffic Prototype
- **Deliverables:**
  - Full implementation of `traffic-ingestion`, `traffic-processing`, and `traffic-publishing` modules.
  - Synthetic GPS fleet simulator generating realistic Bengaluru rush-hour probe streams (Silk Board, Hebbal, ORR, MG Road) with configurable congestion events and spoofed-probe injection tests.
  - Valhalla Meili map matching → directed edge speed aggregation → confidence state machine (`LIVE`, `LIVE_LOW_CONFIDENCE`, `HISTORICAL`, `ESTIMATED`, `STALE`, `NO_DATA`) → atomic `traffic.tar` publication + Martin traffic vector tile overlay.
  - macOS UI displaying honest traffic badges, freshness timestamps, and traffic-aware ETA deltas.
- **Exit Criteria:** End-to-end latency from probe batch ingestion to updated `traffic.tar` and visible map congestion polyline is < 60 seconds; edges with $< 5$ contributors strictly render as `NO_DATA` or `HISTORICAL`/`ESTIMATED` (never falsely as green `LIVE`).

---

### GATE 6 — Privacy-Reviewed Traffic Pilot (Bengaluru)
- **Deliverables:**
  - Independent security & privacy audit against `SECURITY_THREAT_MODEL.md`.
  - Opt-in telemetry controls, automatic start/end trip spatial trimming (500m radius + random 100–300m jitter), ephemeral session ID rotation every 15 minutes, $k$-anonymity ($k \ge 5$) hard enforcement.
  - Sybil/replay/spoofing anomaly detector in `traffic-processing`.
  - Historical traffic profile builder (168-hour weekly 5-minute DCT-compressed buckets for Valhalla predicted traffic).
- **Exit Criteria:** Zero raw GPS trajectories persisted in database or logs; red-team spoofing tests rejected by validation pipeline; pilot operational dashboard live.

---

### GATE 7 — Discovery and Community
- **Deliverables:**
  - Optional Keycloak OIDC login (`accounts`), `saved-places`, shared lists, `reviews`, `contributions` (road closures, accidents, flood reports, business corrections), and `location-sharing` (time-boxed capability links).
  - `media` upload pipeline with EXIF GPS/device stripping and Panoramax street-level imagery viewer integration.
  - Moderation queue and trust-scoring engine for community incident reports.
- **Exit Criteria:** Anonymous users retain full core map/search/routing access; authenticated contributions pass moderation and abuse-rate-limiting tests.

---

### GATE 8 — Transit and Specialized Layers
- **Deliverables:**
  - OpenTripPlanner `2.10` integration (`transit` module) with Bengaluru BMTC and BMRCL static GTFS feeds + service alerts.
  - Weather (`Open-Meteo` adapter), Air Quality (`OpenAQ` adapter), 2D Hillshade DEM layer, Dedicated Cycling Network layer, and EV Charger / Parking PoI filters.
  - Optional AI assistant module behind `AIProvider` interface (server-side tool-calling only; never required for core usage).
- **Exit Criteria:** Multi-modal transit directions functional in Bengaluru; all external enrichment layers degrade gracefully when offline or disabled.

---

### GATE 9 — Phase 2: iOS Application (`apps/ios`)
- **Deliverables:**
  - iOS app built with SwiftUI + MapLibre Native iOS (`7.0+`), sharing core Swift domain networking, offline manager, navigation state machine, and highway shield sprite packs from Phase 1 macOS.
  - Car-safe turn-by-turn navigation UI, background location contribution with explicit separate iOS permission flow and prominent status indicator.
- **Exit Criteria:** Feature parity with macOS; battery/thermal profiling passes during 60-minute navigation + opt-in traffic probe session.

---

### GATE 10 — Phase 3: Android Application (`apps/android`)
- **Deliverables:**
  - Android app built with Kotlin, Jetpack Compose, and MapLibre Native Android, consuming the same `/api/v1` backend, offline region bundles, and highway shield assets.
- **Exit Criteria:** Feature parity with macOS/iOS; passes Android background location privacy review and accessibility talkback checks.

---

### GATE 11 — Phase 4: Self-Hostable Web Application (`apps/web`)
- **Deliverables:**
  - Lightweight, accessible 2D web mapping client using TypeScript + MapLibre GL JS `v6.18+` and `@americana/maplibre-shield-generator`.
  - Packaged as a static/SSR container inside the unified self-hosting Docker Compose / Helm stack.
- **Exit Criteria:** Single-command `docker compose up` deploys full Web UI + API + Tiles + Geocoder + Valhalla + Traffic pipeline for a target region.

---

### GATE 12 — Stabilization, Documentation & Public Release
- **Deliverables:**
  - End-to-end chaos testing, load testing, SBOM generation, automated licence compliance verification, and complete self-hosting operator runbooks (`docs/12_SELF_HOSTING.md`).
- **Exit Criteria:** Production readiness sign-off across all four platforms.
