# ADR-0001: macOS Map Renderer Architecture

- **Status:** Accepted (Gate 1 Spike Verified)
- **Date:** 2026-11-13
- **Deciders:** HEXA Architecture Team

## Context

Phase 1 of HEXA MAPS targets **macOS**. We require a fast, 2D-first vector map renderer that supports MapLibre style specifications, country-specific highway route shields (`packages/highway-shields`), offline `.pmtiles` / `.mbtiles` archives, dark/light themes, keyboard navigation, and accessibility.

Upstream verification of MapLibre in November 2026 shows:
1. **MapLibre Native (`v7.0.0`)** distributes official pre-built Swift packages (`maplibre-gl-native-distribution`) exclusively for **iOS / visionOS**, while documenting that the AppKit macOS target in `maplibre-native` is primarily maintained for engine development/testing and requires macOS 14.3+.
2. **MapLibre GL JS (`v6.18.0`)** is a mature, actively maintained WebGL2 renderer that runs on Apple Silicon `WKWebView` backed by Metal, and natively supports `@americana/maplibre-shield-generator` for country-aware highway shields.

## Options Considered

1. **Option A: MapLibre Native macOS (`MLNMapView` built from C++ source via CMake)**
   - *Pros:* Direct C++ Metal backend, no WebKit process overhead.
   - *Cons:* No official macOS binary distribution; unmaintained AppKit accessibility/gesture glue upstream; requires porting JS shield generator or pre-baking all combinations.
2. **Option B: Native SwiftUI App Shell + MapLibre GL JS `v6.18.0` in `WKWebView` with `WKURLSchemeHandler`**
   - *Pros:* First-class SwiftUI native window, sidebar, search bar, and navigation HUD; zero-network local `.pmtiles` streaming via `WKURLSchemeHandler`; 100% compatibility with `@americana/maplibre-shield-generator` and Phase 4 Web map core; low build friction.
   - *Cons:* ~80–100 MB additional WebKit process memory; requires clean Swift-JS typed bridge.
3. **Option C: Alternative 2D Native Renderer**
   - *Pros:* Full control.
   - *Cons:* Prohibitive engineering effort to replicate MapLibre vector tile styling, text shaping, and collision detection.

## Decision

1. Define a renderer-agnostic Swift interface (`HexaMapCanvasProtocol`) in `apps/macos` so all SwiftUI views, search panels, routing controllers, and offline managers are 100% decoupled from the underlying map view.
2. Execute the Gate 1 benchmark spike ([MACOS_RENDERER_SPIKE.md](file:///Users/vihaang/.gemini/antigravity/scratch/hexa-maps/docs/MACOS_RENDERER_SPIKE.md)) comparing **Option B** and **Option A**.
3. Adopt **Option B (SwiftUI Native Shell + MapLibre GL JS `v6.18.0` via `WKWebView` + `WKURLSchemeHandler`)** as the baseline macOS renderer provided it passes the Gate 1 60fps and $<400\text{ ms}$ startup targets, while using **MapLibre Native iOS (`v7.0+`)** for Phase 2 iOS and **MapLibre Native Android** for Phase 3 Android behind the same domain architecture.
4. Enforce strict 2D-only constraints (`maxPitch: 0`, flat Mercator projection) across all configurations.
