# HEXA MAPS — macOS Renderer Investigation & Spike Plan

**Related ADR:** [ADR-0001: macOS Map Renderer](file:///Users/vihaang/.gemini/antigravity/scratch/hexa-maps/docs/adr/0001-macos-renderer.md)
**Target Platform:** Phase 1 — macOS (Apple Silicon & Intel, macOS 14.4+)

---

## 1. Problem Statement

The first release platform for HEXA MAPS is **macOS**. However, as noted in our project constraints and verified against upstream MapLibre documentation (Nov 2026):
- Official pre-built MapLibre Native Swift Package Manager distributions (`maplibre-gl-native-distribution` `v7.0.0`) target **iOS / visionOS**, not AppKit macOS.
- In the upstream `maplibre-native` C++ repository, the macOS target (`MLNMapView` on AppKit) is documented as primarily used for core engine development and testing, with parts of the AppKit wrapper not actively maintained as a first-class consumer SDK.

Therefore, we must not blindly assume MapLibre Native macOS is the lowest-risk path, nor should we blindly assume a WebView wrapper is sluggish without measurement.

---

## 2. Candidate Evaluation Matrix

| Evaluation Criterion | Candidate A: MapLibre Native macOS (AppKit `MLNMapView` / Metal via CMake/XCFramework) | Candidate B: MapLibre GL JS (`v6.18.0`) inside Native SwiftUI + `WKWebView` (WebGL2 over Metal) | Candidate C: Alternative 2D Native Renderer (e.g., QGIS/CartoType/Custom Metal 2D Renderer) |
| :--- | :--- | :--- | :--- |
| **SwiftUI / AppKit Integration** | **Medium:** Wraps `MLNMapView` in `NSViewRepresentable`. Requires maintaining our own XCFramework build of the macOS target from `maplibre-native`. | **High:** Native SwiftUI window, sidebar, search bar, inspector, and navigation HUD wrap a lightweight `WKWebView` canvas. Zero HTML/CSS chrome—only the 2D map canvas lives in `WKWebView`. | **Low:** Requires writing or adapting an entire MapLibre Style Spec parser, text shaper, and collision engine from scratch. |
| **Metal Rendering & 60/120Hz ProMotion** | Direct C++ Metal backend. | WebKit's WebGL2 implementation on macOS translates directly to Metal via ANGLE. Supports 60/120fps smooth pan/zoom. | Custom Metal or CPU rasterization. |
| **Highway Shield Parity (`packages/highway-shields`)** | Uses pre-built sprite sheets + `MLNStyle` runtime image hooks; requires porting JS `@americana/maplibre-shield-generator` logic or pre-baking all combinations. | **100% Native Compatibility:** Runs `@americana/maplibre-shield-generator` directly via `styleimagemissing` at 60fps in addition to pre-baked sprites. | Must build custom symbol placement and shield renderer from scratch. |
| **Offline Tile Loading (`.pmtiles` / `.mbtiles`)** | Supports `mbtiles://` natively or local loopback server; PMTiles requires custom protocol handler in C++/ObjC. | **Seamless via `WKURLSchemeHandler`:** Swift intercepts `hexa-tiles://` requests in-process (zero TCP loopback port needed) and reads byte ranges directly from local `.pmtiles` or SQLite `.mbtiles` files. | Custom implementation required. |
| **Startup Time & Memory** | ~80–120 ms cold canvas init; ~120–180 MB RSS. | ~150–250 ms `WKWebView` cold init (mitigated by pre-warming); ~180–260 MB RSS. | Variable. |
| **Keyboard & Accessibility (VoiceOver)** | Requires patching unmaintained AppKit accessibility hooks in `MLNMapView`. | Full native SwiftUI accessibility for all UI controls + keyboard arrow/zoom/rotate bindings forwarded to MapLibre GL JS camera API. | High effort. |
| **Build Complexity & Long-Term Maintenance** | **High:** Compiling `maplibre-native` from C++ source via CMake/Bazel on every upstream bump. | **Very Low:** Standard Swift Package / Xcode project bundling local static `maplibre-gl.js` (`v6.18.0`) with Content Security Policy (`default-src 'self' hexa-tiles:`). | **Extreme:** Effectively maintaining a custom map engine. |
| **Licensing** | BSD-2-Clause | BSD-3-Clause | Varies (GPL for QGIS rules it out; MIT/Apache for tiny engines that lack MVT spec support). |

*(Note on Candidate A.2 — Mac Catalyst: Running the iOS `MapLibre.xcframework` via Mac Catalyst is also possible, but forces `UIKit` idioms across the macOS app rather than pure AppKit/SwiftUI.)*

---

## 3. Recommended Spike Architecture: `HexaMapCanvasProtocol`

To make the renderer choice **reversible** and empirical, Gate 1 defines a strict Swift protocol (`HexaMapCanvasProtocol`) in `apps/macos/Sources/HexaMapCore/`:

```swift
public protocol HexaMapCanvasProtocol: AnyObject {
    func setCamera(_ camera: MapCameraState, animated: Bool)
    func setStyle(_ styleVariant: MapStyleVariant) // .light2D, .dark2D, .navigation2D
    func setTrafficOverlayEnabled(_ enabled: Bool)
    func setRoutePolylines(_ routes: [RenderedRoute])
    func setMarkers(_ markers: [MapMarker])
    var onCameraChanged: ((MapCameraState) -> Void)? { get set }
    var onFeatureSelected: ((SelectedMapFeature) -> Void)? { get set }
    var onContextMenuRequested: ((GeoCoordinate, CGPoint) -> Void)? { get set }
}
```

### Gate 1 Spike Execution Plan
1. **Build Prototype B (`WKWebViewMapCanvas`):**
   - Native SwiftUI macOS app shell.
   - Local `WKURLSchemeHandler` serving `hexa-tiles://bengaluru.pmtiles`, local glyphs, and `@americana/maplibre-shield-generator` sprites without any network socket.
   - Enforce 2D-only mode (`maxPitch: 0`, `pitchWithRotate: false`, `dragRotate: true` for 2D compass rotation only).
2. **Build Prototype A (`NativeAppKitMapCanvas`):**
   - Compile `maplibre-native` macOS target via CMake (`MLNMapView`) and bind to `HexaMapCanvasProtocol`.
3. **Quantitative Benchmark Suite:**
   - **Cold time-to-first-tile** on Bengaluru extract (target: $< 400\text{ ms}$).
   - **Frame time p99** during continuous pan/zoom/2D-rotation across dense road shields and 5,000 active traffic polylines (target: $< 16.6\text{ ms}$ for 60fps).
   - **Peak resident memory (RSS)** after 15 minutes of viewport exploration (target: $< 350\text{ MB}$).
   - **Highway Shield visual parity test** across IN (`NH 48`), US (`I-95`), UK (`M25`), and DE (`A7`).
4. **Provisional Recommendation:**
   Adopt **Candidate B (SwiftUI Native Shell + MapLibre GL JS `v6.18.0` in `WKWebView` with `WKURLSchemeHandler`)** as the primary macOS implementation if it meets the $< 400\text{ ms}$ startup and 60fps benchmarks, while retaining `HexaMapCanvasProtocol` so **Phase 2 (iOS)** drops in `MapLibre Native iOS v7.0` with zero changes to SwiftUI view models.
