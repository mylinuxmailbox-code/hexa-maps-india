# ADR-0006: Country-Specific Highway Route Shields Subsystem

- **Status:** Accepted (Gate 1 `@hexa-maps/highway-shields` Implemented & Tested)
- **Date:** 2026-11-13
- **Deciders:** HEXA Architecture Team

## Context

HEXA MAPS must display geographically accurate, country-specific highway route shields worldwide (e.g., Indian `NH`/`SH` yellow-and-black shields, US Interstate/US/State shields, UK `M`/`A` badges, German blue Autobahn hexagons and yellow Bundesstraße rectangles) rather than generic white pills. The solution must work identically across macOS, iOS, Android, and Web, and must respect artwork/trademark licensing.

## Decision

1. **Create Shared Package (`packages/highway-shields`):**
   - Centralize all route-network resolution (`network`, `ref`, `iso_a2`), reference formatting, SVG shield definitions, and sprite generation in `packages/highway-shields`.
2. **Build on OpenStreetMap Americana (`CC0-1.0`):**
   - Reuse and adapt the public-domain (`CC0-1.0`) shield definitions and rendering algorithms from `@americana/maplibre-shield-generator` and `openstreetmap-americana`, replacing any restricted heraldic/crown crests with clean geometric cartographic equivalents.
3. **Preserve Route Relations in Vector Tiles:**
   - Configure our Planetiler tile pipeline so the `transportation_name` layer preserves `network` (e.g., `IN:NH`, `IN:SH`, `US:I`, `US:US`, `GB:M`, `DE:A`, `e-road`) and `ref` across all concurrent route memberships on a road segment.
4. **Cross-Platform Rendering Contract:**
   - Generate multi-DPI nine-slice sprite sheets (`stretchX`, `stretchY`, `content` boxes) at build time for instant native rendering on MapLibre Native (iOS/Android/macOS) and MapLibre GL JS, supplemented by dynamic runtime shield synthesis for composite shields.
5. **Safe Unknown-Network Fallback:**
   - If a road carries a `ref` with an unrecognized or missing `network` definition, render a clean neutral fallback pill (never another country's shield) and emit a non-PII diagnostic counter so missing network definitions can be added systematically.
