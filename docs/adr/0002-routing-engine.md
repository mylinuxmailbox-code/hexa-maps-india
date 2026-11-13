# ADR-0002: Routing Engine Selection

- **Status:** Proposed
- **Date:** 2026-11-13
- **Deciders:** HEXA Architecture Team

## Context

HEXA MAPS requires a self-hostable, open-source routing engine supporting:
- Multi-modal profiles (driving, walking, cycling, hiking).
- Dynamic costing options (avoid tolls, highways, ferries; accessible routing).
- Turn-by-turn maneuver generation and voice guidance metadata.
- GPS trace map-matching for the HEXA Traffic pipeline.
- Dynamic live traffic speed overlays without rebuilding the entire routing graph.
- Offline on-device routing using regional tile extracts.

## Options Considered

1. **Valhalla (`v3.6.3` / `v3.9.1`, MIT Licence)**
   - Dynamic tiled hierarchical graph architecture.
   - Built-in Meili map-matching (`trace_route`, `trace_attributes`).
   - Built-in memory-mapped live traffic overlay (`traffic.tar`) and DCT-compressed weekly historical speed profiles (`predicted_speeds`).
   - Regional tiles can be clipped and downloaded for offline on-device routing.
2. **OSRM (BSD-2-Clause)**
   - Extremely fast Contraction Hierarchies (CH) / Multi-Level Dijkstra (MLD), but requires heavy graph re-customization for traffic updates, lacks tiled partial downloads for mobile offline use, and has rigid profile customization.
3. **GraphHopper (Apache-2.0)**
   - Mature JVM routing engine, but lacks Valhalla's native memory-mapped `traffic.tar` + tiled offline C++ portability across mobile clients.

## Decision

Select **Valhalla** behind a provider-independent `RoutingProvider` and `MapMatchingProvider` interface inside the HEXA Modular Monolith (`services/api/src/modules/routing`). Do not integrate multiple road routing engines concurrently unless a concrete benchmark gap emerges.
