# ADR-0003: Geocoding & Search Engine Architecture

- **Status:** Proposed
- **Date:** 2026-11-13
- **Deciders:** HEXA Architecture Team

## Context

HEXA MAPS requires fast search autocomplete, forward address/place geocoding, reverse geocoding, category discovery, and offline fallback search—without relying on public rate-limited Nominatim endpoints or proprietary APIs.

## Options Considered

1. **Photon (`v1.3.0`, Apache-2.0, backed by OpenSearch)** + **PostGIS Spatial POI Index** + **SQLite FTS5 (Offline)**
   - Photon `1.0+` (Feb 2026) and `1.3.0` (Aug 2026) migrated to OpenSearch, reduced full-planet index size to ~95 GB, improved street-number and postcode matching, and excels at low-latency typo-tolerant autocomplete.
   - PostGIS (`3.7.0`) excels at strict spatial radius/bounding-box category queries (`amenity=charging_station`, `amenity=hospital`, etc.) with structured OSM tags and HEXA community enrichment.
   - SQLite FTS5 + R-Tree provides lightweight offline search inside downloaded regional packs.
2. **Pelias (MIT)**
   - Modular multi-source geocoder, but operationally heavier (multiple microservices, Elasticsearch pipelines, Who's On First imports) for single-command self-hosters.
3. **Self-Hosted Nominatim (GPL-2.0)**
   - Accurate structured address resolution and OSM diff updates, but explicitly not designed for keystroke-by-keystroke autocomplete.

## Decision

Adopt a composite **`GeocodingProvider`** strategy:
1. **Primary Online Autocomplete & Forward/Reverse Geocoder:** Self-hosted **Photon `v1.3.0`**.
2. **Nearby Category & Structured Place Search:** **PostgreSQL + PostGIS `3.7.0`**.
3. **Offline Regional Search:** Pre-built **SQLite FTS5 + R-Tree** regional database bundled with offline `.pmtiles` packages.
4. Keep the interface pluggable so self-hosters can optionally register Pelias or self-hosted Nominatim as secondary/fallback providers.
