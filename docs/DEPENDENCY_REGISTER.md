# HEXA MAPS — Dependency Register

**Verification Date:** 2026-11-13
**Policy:** Every upstream dependency must be genuinely open-source, actively maintained, self-hostable, and compatible with our 2D-first constraint (we explicitly disable any 3D/globe capabilities in upstream libraries).

---

## 1. Core Geospatial & Rendering Dependencies

### 1.1 MapLibre GL JS
- **Repository:** https://github.com/maplibre/maplibre-gl-js
- **Latest Verified Version:** `v6.18.0` (verified Nov 2026; `v6.0.0` transitioned to ESM-only and WebGL2 in July 2026)
- **Licence:** BSD-3-Clause
- **Supported Platforms:** Web browsers, macOS `WKWebView` (with Metal-backed WebGL2)
- **Maintenance State:** Actively maintained by the MapLibre Organization.
- **Integration Requirements:** Bundled locally in `WKWebView` for macOS Candidate B or served via self-hosted web app. Must enforce `maxPitch: 0` and flat mercator projection to strictly adhere to the 2D-first constraint.
- **Security Concerns:** Standard browser/WebView sandboxing; disable external telemetry or third-party tile URLs by default.
- **Self-Hosting Requirements:** Zero external runtime calls; loads local or self-hosted style JSON, sprites, glyphs, and vector tiles.
- **Known Limitations:** WebView bridge overhead if serializing millions of points across JS-Swift boundary (mitigated by loading vector/GeoJSON sources directly via custom `WKURLSchemeHandler`).

### 1.2 MapLibre Native (iOS / Android / macOS C++)
- **Repository:** https://github.com/maplibre/maplibre-native & https://github.com/maplibre/maplibre-gl-native-distribution
- **Latest Verified Version:** `7.0.0` (iOS SPM distribution, verified Nov 2026)
- **Licence:** BSD-2-Clause
- **Supported Platforms:** iOS (first-class), Android (first-class), macOS (C++/AppKit development target)
- **Maintenance State:** High activity for iOS (Metal) and Android (Vulkan/OpenGL ES). **Warning for macOS:** Official binary Swift packages (`maplibre-gl-native-distribution`) target iOS/visionOS; upstream documentation explicitly notes macOS AppKit support is primarily maintained for core development/testing and requires macOS 14.3+.
- **Known Limitations:** On macOS, requires either custom CMake/Bazel compilation of the AppKit `MLNMapView` target or Mac Catalyst; evaluated against `WKWebView` in [MACOS_RENDERER_SPIKE.md](file:///Users/vihaang/.gemini/antigravity/scratch/hexa-maps/docs/MACOS_RENDERER_SPIKE.md).

### 1.3 Americana Highway Shield Generator (`@americana/maplibre-shield-generator`)
- **Repository:** https://github.com/osm-americana/maplibre-shield-generator & https://github.com/osm-americana/openstreetmap-americana
- **Latest Verified Version:** Active monorepo releases (2026)
- **Licence:** CC0-1.0 (Public Domain Dedication) for code and SVG shield definitions (subject to trademark/insignia caveats on specific national symbols).
- **Supported Platforms:** Cross-platform via MapLibre `styleimagemissing` runtime synthesis (JS) or build-time deterministic sprite sheet + SDF/metadata generation for Native SDKs.
- **Maintenance State:** Actively maintained by the OpenStreetMap Americana community.
- **Known Limitations:** Designed first for JS runtime callbacks; for iOS/Android/macOS Native compatibility, HEXA must wrap its shield definitions in a shared renderer that supports both dynamic sprite synthesis and pre-generated multi-DPI sprite atlases.

### 1.4 Planetiler
- **Repository:** https://github.com/onthegomap/planetiler
- **Latest Verified Version:** `0.9.x` / 2026 snapshot builds
- **Licence:** Apache-2.0
- **Supported Platforms:** JVM (Java 21+, Linux/macOS/Docker)
- **Maintenance State:** Actively maintained.
- **Self-Hosting Requirements:** Generates `.pmtiles` or `.mbtiles` from `.osm.pbf` extracts in minutes for regional extracts (e.g., Bengaluru / India) and a few hours for the full planet.
- **Data Dependencies:** OpenStreetMap `.osm.pbf`, Natural Earth, OpenMapTiles schema compatibility (`transportation_name` layer with `network` and `ref` tags).

### 1.5 Martin Tile Server
- **Repository:** https://github.com/maplibre/martin
- **Latest Verified Version:** `v1.8.x` (2026 release line)
- **Licence:** MIT / Apache-2.0
- **Supported Platforms:** Linux, macOS, Windows, Docker (Rust binary)
- **Maintenance State:** Actively maintained under the MapLibre umbrella.
- **Self-Hosting Requirements:** Serves vector tiles from `.pmtiles`, `.mbtiles`, and PostGIS tables, plus MapLibre sprites and SDF font glyphs, with hot-reload support.

---

## 2. Routing, Geocoding & Transit Engines

### 2.1 Valhalla
- **Repository:** https://github.com/valhalla/valhalla
- **Latest Verified Version:** `3.6.3` (Feb 2026) / `3.9.1` (Late 2026)
- **Licence:** MIT
- **Supported Platforms:** Linux, macOS (C++17/20, Docker)
- **Maintenance State:** Actively maintained.
- **Integration Requirements:** Provides turn-by-turn routing (`route`), map-matching (`trace_route` / `trace_attributes` via Meili), isochrones, matrix, and live traffic overlay consumption via memory-mapped `traffic.tar` (`mjolnir.traffic_extract`).
- **Known Limitations:** Graph builds (`valhalla_build_tiles`) produce hierarchical tiles whose `GraphId` (level, tile_id, edge_id) changes whenever the underlying OSM extract is rebuilt. Requires explicit `graph_version_id` pinning in HEXA Traffic.

### 2.2 Photon Geocoder
- **Repository:** https://github.com/komoot/photon
- **Latest Verified Version:** `v1.3.0` (Aug 2026, following major `v1.0.0` OpenSearch migration in Feb 2026)
- **Licence:** Apache-2.0
- **Supported Platforms:** Java 21+ (Linux, macOS, Docker)
- **Maintenance State:** Actively maintained by Komoot and community.
- **Self-Hosting Requirements:** Backed by OpenSearch (v1.0+ cut planet index size to ~95 GB and simplified language-agnostic indexing). Supports high-throughput search autocomplete, forward geocoding, and reverse geocoding without Nominatim rate-limit restrictions.

### 2.3 OpenTripPlanner (OTP)
- **Repository:** https://github.com/opentripplanner/OpenTripPlanner
- **Latest Verified Version:** `v2.10.0` (2026)
- **Licence:** LGPL-3.0-or-later
- **Supported Platforms:** JVM (Java 21+, Docker)
- **Maintenance State:** Actively maintained.
- **Integration Requirements:** Consumes OSM `.pbf` + GTFS static `.zip` + GTFS-Realtime (Protobuf) feeds for multi-modal transit routing.
- **Known Limitations:** Transit routing quality is strictly bounded by local agency GTFS/GTFS-RT availability (e.g., BMTC/BMRCL in Bengaluru).

### 2.4 Panoramax
- **Repository:** https://gitlab.com/panoramax
- **Latest Verified Version:** `v2.17.0` (2026)
- **Licence:** MIT (web viewer / API components)
- **Supported Platforms:** Docker / Python / Web
- **Maintenance State:** Actively maintained by IGN France and OSM community.
- **Known Limitations:** Software is MIT-licensed, but individual street-level photos carry their own licences (typically CC-BY-SA-4.0 or CC-BY-4.0) which must be attributed per image in the UI.

---

## 3. Data Storage, Streaming, Auth & Observability

### 3.1 PostgreSQL + PostGIS
- **Repository:** https://github.com/postgis/postgis
- **Latest Verified Version:** PostgreSQL `17.x`/`18.x` + PostGIS `3.7.0` (2026)
- **Licence:** PostgreSQL Licence (PostgreSQL) / GPL-2.0-or-later (PostGIS extension)
- **Purpose:** Spatial database for places, community contributions, road segment metadata, and aggregated historical traffic profiles.
- **Licence Note:** Running PostGIS as an unmodified database server over a standard SQL socket does not trigger GPL copyleft on the connecting application backend.

### 3.2 S3-Compatible Object Storage: SeaweedFS (Replacing MinIO)
- **Repository:** https://github.com/seaweedfs/seaweedfs
- **Latest Verified Version:** Active 2026 releases (`3.8x+`)
- **Licence:** Apache-2.0
- **Why Not MinIO:** Between May 2025 and early 2026, MinIO removed admin features from its open-source edition, ceased publishing official pre-built community Docker images, and archived its community edition track in favor of commercial AIStor.
- **Recommendation:** Use **SeaweedFS** (Apache-2.0) or **Garage** (AGPLv3) for self-hosted S3-compatible storage of `.pmtiles`, `traffic.tar` archives, and user media. SeaweedFS is preferred for its permissive Apache-2.0 licence and fast small/large file handling.

### 3.3 Streaming / Queue: NATS JetStream (Default) vs. Kafka (Scale Option)
- **Repository:** https://github.com/nats-io/nats-server
- **Latest Verified Version:** `v2.11.x` (2026)
- **Licence:** Apache-2.0
- **Purpose:** Ingesting GPS traffic probes with persistence, replay, and backpressure without the multi-gigabyte JVM operational footprint of Kafka for single-city self-hosters. Behind a `TrafficStreamProvider` interface so operators can swap in Kafka/Redpanda if desired.

### 3.4 Identity Provider: Keycloak
- **Repository:** https://github.com/keycloak/keycloak
- **Latest Verified Version:** `26.8.2` (2026)
- **Licence:** Apache-2.0
- **Purpose:** Optional OIDC/OAuth2 authentication for community contributions, saved lists sync, and admin access. Never required for map viewing, search, or routing.

### 3.5 Telemetry: OpenTelemetry
- **Repository:** https://github.com/open-telemetry
- **Licence:** Apache-2.0
- **Purpose:** Privacy-filtered metrics, distributed tracing, and traffic pipeline freshness monitoring.
