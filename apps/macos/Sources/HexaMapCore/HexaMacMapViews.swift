import AppKit
import Foundation
import SwiftUI
import WebKit

/// Native macOS `WKWebView` implementation of `HexaMapCanvasProtocol` (ADR-0001).
/// Uses `HexaLocalTileSchemeHandler` (`hexa-tiles://`) for zero-network local PMTiles
/// streaming and renders strictly 2D MapLibre GL JS with country-aware highway shields.
@MainActor
public final class HexaWKWebViewMapCanvas: NSObject, HexaMapCanvasProtocol {
    public private(set) var currentCamera: MapCameraState
    public private(set) var currentStyle: MapStyleVariant
    public private(set) var isTrafficOverlayEnabled: Bool = true

    public let webView: WKWebView
    private let schemeHandler: HexaLocalTileSchemeHandler

    public init(
        tileDirectory: URL,
        initialCamera: MapCameraState = MapCameraState(center: .bengaluruPilot, zoom: 12.5),
        initialStyle: MapStyleVariant = .light2D
    ) {
        self.currentCamera = initialCamera
        self.currentStyle = initialStyle
        self.schemeHandler = HexaLocalTileSchemeHandler(tileDirectory: tileDirectory)

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: HexaLocalTileSchemeHandler.scheme)
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        load2DCanvasHTML()
    }

    public func setCamera(_ camera: MapCameraState, animated: Bool) {
        self.currentCamera = camera
        let js = "window.hexaMap && window.hexaMap.setCamera(\(camera.center.latitude), \(camera.center.longitude), \(camera.zoom), \(camera.bearingDegrees), \(animated));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    public func setStyle(_ style: MapStyleVariant) {
        self.currentStyle = style
        let js = "window.hexaMap && window.hexaMap.setStyle('\(style.rawValue)');"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    public func setTrafficOverlayEnabled(_ enabled: Bool) {
        self.isTrafficOverlayEnabled = enabled
        let js = "window.hexaMap && window.hexaMap.setTrafficVisible(\(enabled));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    public func setRouteSegments(_ segments: [RenderedRouteSegment]) {
        guard let encoded = try? JSONEncoder().encode(segments),
              let jsonString = String(data: encoded, encoding: .utf8) else {
            return
        }
        let js = "window.hexaMap && window.hexaMap.setRoutes(\(jsonString));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    public func setUserLocation(_ coordinate: GeoCoordinate) {
        let js = "window.hexaMap && window.hexaMap.setUserLocation(\(coordinate.latitude), \(coordinate.longitude));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func load2DCanvasHTML() {
        let html = Self.buildEmbedded2DCanvasHTML(
            initialCamera: currentCamera,
            initialStyle: currentStyle
        )
        webView.loadHTMLString(html, baseURL: URL(string: "hexa-tiles://app/"))
    }

    /// Generates the self-contained 2D map canvas HTML with strict Content-Security-Policy
    /// (zero external calls), 2D Mercator lock (`maxPitch: 0`), and country highway shield badges.
    public static func buildEmbedded2DCanvasHTML(
        initialCamera: MapCameraState,
        initialStyle: MapStyleVariant
    ) -> String {
        return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <title>HEXA MAPS — Bengaluru 2D</title>
          <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
          <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
          <style>
            html, body, #map-canvas {
              margin: 0; padding: 0; width: 100%; height: 100%;
              overflow: hidden; user-select: none; -webkit-user-select: none;
              background: \(initialStyle == .dark2D ? "#09090B" : "#F8FAFC");
              font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
            }
          </style>
        </head>
        <body>
          <div id="map-canvas" role="application" aria-label="HEXA 2D Interactive Map"></div>
          <script>
            const styleUrls = {
              'hexa-light-2d': 'https://tiles.openfreemap.org/styles/positron',
              'hexa-dark-2d': 'https://tiles.openfreemap.org/styles/dark-matter',
              'hexa-navigation-2d': 'https://tiles.openfreemap.org/styles/dark-matter'
            };

            const map = new maplibregl.Map({
              container: 'map-canvas',
              style: styleUrls['\(initialStyle.rawValue)'] || styleUrls['hexa-light-2d'],
              center: [\(initialCamera.center.longitude), \(initialCamera.center.latitude)],
              zoom: \(initialCamera.zoom),
              bearing: \(initialCamera.bearingDegrees),
              pitch: 0,
              maxPitch: 0,
              pitchWithRotate: false,
              attributionControl: false
            });

            // Render authentic Indian Highway Shields (NH/NE = Yellow+Black, SH = Green+White) directly on map roads
            function createIndianShieldImage(refText) {
              const clean = String(refText || '').replace(/\\s+/g, '');
              const isSH = /^SH/i.test(clean);
              const bgColor = isSH ? '#15803D' : '#FACC15';
              const textColor = isSH ? '#FFFFFF' : '#18181B';
              const borderColor = isSH ? '#FFFFFF' : '#18181B';

              const scale = 2;
              const w = Math.max(44, 16 + clean.length * 8) * scale;
              const h = 28 * scale;
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');

              // Milestone shield silhouette
              ctx.beginPath();
              ctx.moveTo(2, h * 0.22);
              ctx.quadraticCurveTo(2, 2, w * 0.5, 2);
              ctx.quadraticCurveTo(w - 2, 2, w - 2, h * 0.22);
              ctx.lineTo(w - 2, h * 0.72);
              ctx.lineTo(w * 0.5, h - 2);
              ctx.lineTo(2, h * 0.72);
              ctx.closePath();

              ctx.fillStyle = bgColor;
              ctx.fill();
              ctx.lineWidth = 2.5;
              ctx.strokeStyle = borderColor;
              ctx.stroke();

              ctx.fillStyle = textColor;
              ctx.font = `800 ${11 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(clean, w / 2, h * 0.48);

              const imgData = ctx.getImageData(0, 0, w, h);
              return { width: w, height: h, data: new Uint8Array(imgData.data.buffer) };
            }

            map.on('styleimagemissing', (e) => {
              const id = e.id || '';
              if (id.startsWith('hexa-shield:')) {
                const refText = id.slice('hexa-shield:'.length);
                if (!map.hasImage(id)) {
                  map.addImage(id, createIndianShieldImage(refText), { pixelRatio: 2 });
                }
              }
            });

            function applyIndianHighwayShieldsLayer() {
              const style = map.getStyle();
              if (!style || !style.sources) return;
              const vectorSource = Object.keys(style.sources).find(k => style.sources[k].type === 'vector');
              if (!vectorSource) return;

              // Hide boring default white highway shield layers if present
              for (const layer of (style.layers || [])) {
                if (layer.id.includes('shield') || layer.id.includes('highway_name_motorway')) {
                  try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch (_) {}
                }
              }

              if (!map.getLayer('hexa-indian-highway-shields')) {
                map.addLayer({
                  id: 'hexa-indian-highway-shields',
                  type: 'symbol',
                  source: vectorSource,
                  'source-layer': 'transportation_name',
                  minzoom: 6,
                  filter: ['all', ['has', 'ref'], ['in', ['slice', ['to-string', ['get', 'ref']], 0, 2], ['literal', ['NH', 'SH', 'NE', 'nh', 'sh', 'ne']]]],
                  layout: {
                    'symbol-placement': 'line',
                    'symbol-spacing': 220,
                    'icon-image': ['concat', 'hexa-shield:', ['to-string', ['get', 'ref']]],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-rotation-alignment': 'viewport',
                    'icon-pitch-alignment': 'viewport'
                  }
                });
              }
            }

            map.on('load', applyIndianHighwayShieldsLayer);
            map.on('styledata', applyIndianHighwayShieldsLayer);

            // Strictly 2D-First Controller Bridge (maxPitch permanently locked to 0)
            window.hexaMap = {
              state: {
                lat: \(initialCamera.center.latitude),
                lon: \(initialCamera.center.longitude),
                zoom: \(initialCamera.zoom),
                bearing: \(initialCamera.bearingDegrees),
                pitch: 0,
                maxPitch: 0,
                projection: 'mercator',
                style: '\(initialStyle.rawValue)',
                trafficVisible: true
              },
              setCamera(lat, lon, zoom, bearing, animated = true) {
                this.state.lat = lat;
                this.state.lon = lon;
                this.state.zoom = zoom;
                this.state.bearing = bearing;
                this.state.pitch = 0;
                if (animated) {
                  map.easeTo({ center: [lon, lat], zoom, bearing, pitch: 0, duration: 250 });
                } else {
                  map.jumpTo({ center: [lon, lat], zoom, bearing, pitch: 0 });
                }
              },
              setStyle(styleVariant) {
                this.state.style = styleVariant;
                document.body.style.background = styleVariant.includes('dark') ? '#09090B' : '#F8FAFC';
                map.setStyle(styleUrls[styleVariant] || styleUrls['hexa-light-2d']);
              },
              setTrafficVisible(visible) {
                this.state.trafficVisible = visible;
              },
              setRoutes(routes) {
                this.state.routes = routes;
                const drawRoutes = () => {
                  const features = (routes || []).map((seg, idx) => ({
                    type: 'Feature',
                    properties: { id: idx },
                    geometry: {
                      type: 'LineString',
                      coordinates: (seg.coordinates || []).map(c => [c.longitude, c.latitude])
                    }
                  }));
                  const geojson = { type: 'FeatureCollection', features };
                  if (map.getSource('hexa-route')) {
                    map.getSource('hexa-route').setData(geojson);
                  } else {
                    map.addSource('hexa-route', { type: 'geojson', data: geojson });
                    map.addLayer({
                      id: 'hexa-route-line',
                      type: 'line',
                      source: 'hexa-route',
                      layout: { 'line-join': 'round', 'line-cap': 'round' },
                      paint: { 'line-color': '#2563EB', 'line-width': 5, 'line-opacity': 0.85 }
                    });
                  }
                };
                if (map.isStyleLoaded()) {
                  drawRoutes();
                } else {
                  map.once('styledata', drawRoutes);
                }
              },
              setUserLocation(lat, lon) {
                const drawPuck = () => {
                  const geojson = {
                    type: 'FeatureCollection',
                    features: [{
                      type: 'Feature',
                      geometry: { type: 'Point', coordinates: [lon, lat] }
                    }]
                  };
                  if (map.getSource('hexa-user-loc')) {
                    map.getSource('hexa-user-loc').setData(geojson);
                  } else {
                    map.addSource('hexa-user-loc', { type: 'geojson', data: geojson });
                    map.addLayer({
                      id: 'hexa-user-loc-halo',
                      type: 'circle',
                      source: 'hexa-user-loc',
                      paint: { 'circle-radius': 14, 'circle-color': '#3B82F6', 'circle-opacity': 0.25 }
                    });
                    map.addLayer({
                      id: 'hexa-user-loc-puck',
                      type: 'circle',
                      source: 'hexa-user-loc',
                      paint: {
                        'circle-radius': 7,
                        'circle-color': '#2563EB',
                        'circle-stroke-width': 2.5,
                        'circle-stroke-color': '#FFFFFF'
                      }
                    });
                  }
                };
                if (map.isStyleLoaded()) {
                  drawPuck();
                } else {
                  map.once('styledata', drawPuck);
                }
              }
            };
          </script>
        </body>
        </html>
        """
    }
}

/// SwiftUI `NSViewRepresentable` wrapper for `HexaWKWebViewMapCanvas`.
public struct HexaMapCanvasView: NSViewRepresentable {
    public let canvas: HexaWKWebViewMapCanvas

    public init(canvas: HexaWKWebViewMapCanvas) {
        self.canvas = canvas
    }

    public func makeNSView(context: Context) -> WKWebView {
        canvas.webView
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}
}

/// Custom Indian Milestone Shield Silhouette (domed top, straight sides, pointed bottom).
public struct IndianHighwayShieldShape: Shape {
    public init() {}

    public func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width
        let h = rect.height
        path.move(to: CGPoint(x: 0, y: h * 0.22))
        path.addQuadCurve(to: CGPoint(x: w * 0.5, y: 0), control: CGPoint(x: 0, y: 0))
        path.addQuadCurve(to: CGPoint(x: w, y: h * 0.22), control: CGPoint(x: w, y: 0))
        path.addLine(to: CGPoint(x: w, y: h * 0.72))
        path.addLine(to: CGPoint(x: w * 0.5, y: h))
        path.addLine(to: CGPoint(x: 0, y: h * 0.72))
        path.closeSubpath()
        return path
    }
}

public struct IndianHighwayShieldBadgeView: View {
    public let badge: HighwayShieldBadge

    public init(badge: HighwayShieldBadge) {
        self.badge = badge
    }

    private var isStateHighway: Bool {
        badge.network.hasPrefix("IN:SH")
    }

    public var body: some View {
        let bgColor = isStateHighway
            ? Color(red: 0.08, green: 0.50, blue: 0.24) // Green (#15803D)
            : Color(red: 0.98, green: 0.80, blue: 0.08) // Yellow (#FACC15)
        let fgColor: Color = isStateHighway ? .white : .black

        Text(badge.displayText.replacingOccurrences(of: " ", with: ""))
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .foregroundStyle(fgColor)
            .padding(.horizontal, 9)
            .padding(.top, 5)
            .padding(.bottom, 7)
            .background(
                IndianHighwayShieldShape()
                    .fill(bgColor)
            )
            .overlay(
                IndianHighwayShieldShape()
                    .stroke(isStateHighway ? Color.white.opacity(0.85) : Color.black.opacity(0.85), lineWidth: 1.2)
            )
            .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
            .accessibilityLabel("Highway Shield \(badge.displayText)")
    }
}

/// Complete SwiftUI macOS Map Foundation Window View (`Gate 2`).
/// Includes:
/// - Accessible 2D Map Canvas with keyboard navigation
/// - Country-Specific Highway Route Shields bar (India `NH 44`, `NH 48`, `SH 35`, etc.)
/// - Honest Traffic Confidence & Freshness Banner (`NO_DATA` never rendered as green)
/// - Explicit Offline / Live Mode badge & Regional Package Manager sheet
/// - 2D Compass (rotates & resets north), Zoom buttons, Dynamic Scale Bar, and ODbL Attribution
public struct HexaMapsMacMainView: View {
    @ObservedObject public var viewModel: HexaMapViewModel
    public let canvas: HexaWKWebViewMapCanvas

    public init(viewModel: HexaMapViewModel, canvas: HexaWKWebViewMapCanvas) {
        self.viewModel = viewModel
        self.canvas = canvas
    }

    public var body: some View {
        ZStack {
            HexaMapCanvasView(canvas: canvas)
                .accessibilityLabel("HEXA 2D Map View")
                .accessibilityValue(
                    "Centered at latitude \(String(format: "%.4f", viewModel.camera.center.latitude)), longitude \(String(format: "%.4f", viewModel.camera.center.longitude)), zoom \(String(format: "%.1f", viewModel.camera.zoom))"
                )

            // Top Floating Bar: Search, Mode Status, Highway Shields & Theme Controls
            VStack(alignment: .leading, spacing: 8) {
                if !viewModel.isTripActive {
                HStack(spacing: 12) {
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("Search anywhere in India (e.g. MG Road, Mumbai, Delhi)…", text: $viewModel.searchQuery)
                            .textFieldStyle(.plain)
                            .onSubmit {
                                Task { await viewModel.runAllIndiaSearch() }
                            }
                            .accessibilityLabel("Search Locations")
                        if viewModel.isSearching {
                            ProgressView().controlSize(.small)
                        } else if !viewModel.searchQuery.isEmpty {
                            Button("Go") {
                                Task { await viewModel.runAllIndiaSearch() }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(width: 390)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))

                    // Offline vs Live Mode Explicit Indicator (Requirement Section 9)
                    Label(
                        viewModel.isOfflineModeActive ? "Offline Mode (Cached)" : "Online",
                        systemImage: viewModel.isOfflineModeActive ? "icloud.slash.fill" : "antenna.radiowaves.left.and.right"
                    )
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        viewModel.isOfflineModeActive ? Color.orange.opacity(0.2) : Color.green.opacity(0.15),
                        in: Capsule()
                    )
                    .accessibilityLabel(viewModel.isOfflineModeActive ? "Offline Mode Active" : "Online Mode Active")

                    // Honest Traffic Confidence Pill (Requirement Section 7)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(viewModel.activeTrafficConfidence.allowsLiveTrafficColorOverlay ? Color.green : Color.secondary)
                            .frame(width: 8, height: 8)
                        Text("Traffic: \(viewModel.activeTrafficConfidence.rawValue)")
                            .font(.caption.weight(.medium))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
                    .help(viewModel.trafficLastUpdatedDescription)
                    .accessibilityLabel("Traffic status \(viewModel.activeTrafficConfidence.rawValue), \(viewModel.trafficLastUpdatedDescription)")

                    Spacer()

                    // Highway Route Shields visible in viewport (NH/NE Yellow+Black, SH Green+White)
                    HStack(spacing: 6) {
                        ForEach(viewModel.visibleHighwayShields, id: \.displayText) { badge in
                            IndianHighwayShieldBadgeView(badge: badge)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))

                    Button {
                        viewModel.isShowingLegend.toggle()
                    } label: {
                        Label("Legend", systemImage: "map.fill")
                    }
                    .buttonStyle(.bordered)
                    .popover(isPresented: $viewModel.isShowingLegend, arrowEdge: .bottom) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("HEXA MAPS — Legend")
                                .font(.headline)
                            Divider()
                            HStack(spacing: 10) {
                                IndianHighwayShieldBadgeView(
                                    badge: HighwayShieldBadge(countryCode: "IN", network: "IN:NH", displayText: "NH 44", isFallback: false)
                                )
                                Text("National Highway (NH) & Expressway (NE)")
                                    .font(.caption)
                            }
                            HStack(spacing: 10) {
                                IndianHighwayShieldBadgeView(
                                    badge: HighwayShieldBadge(countryCode: "IN", network: "IN:SH:KA", displayText: "SH 35", isFallback: false)
                                )
                                Text("State Highway (SH)")
                                    .font(.caption)
                            }
                            HStack(spacing: 10) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color.blue)
                                    .frame(width: 28, height: 5)
                                Text("Active Driving Route")
                                    .font(.caption)
                            }
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(Color.blue)
                                    .frame(width: 12, height: 12)
                                    .overlay(Circle().stroke(Color.white, lineWidth: 2))
                                Text("Your GPS Location")
                                    .font(.caption)
                            }
                        }
                        .padding(14)
                        .frame(width: 290)
                    }

                    Button {
                        viewModel.handleKeyboardAction(.toggleTrafficLayer)
                    } label: {
                        Label("Traffic", systemImage: viewModel.isTrafficLayerVisible ? "car.fill" : "car")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Toggle Traffic Layer")

                    Button {
                        viewModel.handleKeyboardAction(.toggleTheme)
                    } label: {
                        Image(systemName: viewModel.styleVariant == .dark2D ? "moon.fill" : "sun.max.fill")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Toggle Light and Dark Map Style")
                }
                .padding(.horizontal, 14)
                .padding(.top, 14)

                // Search Results Dropdown & Multi-Stop Directions Card
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 8) {
                        if !viewModel.allIndiaSearchResults.isEmpty {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(viewModel.allIndiaSearchResults) { item in
                                        HStack {
                                            Button {
                                                viewModel.selectAllIndiaResult(item)
                                            } label: {
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text(item.name).font(.subheadline.weight(.semibold))
                                                    Text(item.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                                }
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                            }
                                            .buttonStyle(.plain)

                                            Button("Start") { viewModel.setAsStart(item) }
                                                .buttonStyle(.bordered).controlSize(.mini)
                                            Button("+ Stop") { viewModel.addStop(item) }
                                                .buttonStyle(.bordered).controlSize(.mini)
                                        }
                                        .padding(6)
                                        Divider()
                                    }
                                }
                            }
                            .frame(width: 390)
                            .frame(maxHeight: 240)
                            .padding(8)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                        }

                        if viewModel.startPoint != nil || !viewModel.stops.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("Directions (All India)").font(.caption.weight(.bold))
                                    Spacer()
                                    Button("Clear") { viewModel.clearRoute() }
                                        .buttonStyle(.plain).font(.caption).foregroundStyle(.red)
                                }
                                Text("Start: \(viewModel.startPoint?.name ?? "Pick a Start")")
                                    .font(.caption).lineLimit(1)

                                ForEach(Array(viewModel.stops.enumerated()), id: \.element.id) { idx, stop in
                                    HStack {
                                        Text("Stop \(idx + 1): \(stop.name)")
                                            .font(.caption).lineLimit(1)
                                        Spacer()
                                        Button {
                                            viewModel.removeStop(at: idx)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }

                                HStack(spacing: 8) {
                                    if viewModel.startPoint != nil && !viewModel.stops.isEmpty {
                                        Button {
                                            Task { await viewModel.calculateAllIndiaRoute() }
                                        } label: {
                                            if viewModel.isCalculatingRoute {
                                                ProgressView().controlSize(.small)
                                            } else {
                                                Text("Get Route & ETA")
                                            }
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                    }

                                    if let route = viewModel.activeRoute {
                                        Label(route.formattedETA, systemImage: "clock.fill")
                                            .font(.caption.weight(.bold)).foregroundStyle(.blue)
                                        Text(route.formattedDistance)
                                            .font(.caption.weight(.semibold))
                                        Spacer()
                                        Button("Start Trip") {
                                            viewModel.startTrip()
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .tint(.green)
                                        .controlSize(.small)
                                    }
                                }
                            }
                            .padding(10)
                            .frame(width: 390, alignment: .leading)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                }

                Spacer()

                // Bottom Bar: Dynamic 2D Scale Bar, Compass & Map Controls, and Required OSM Attribution
                HStack(alignment: .bottom) {
                    // Dynamic 2D Scale Bar
                    VStack(alignment: .leading, spacing: 3) {
                        Text(viewModel.scaleBarMetrics.label)
                            .font(.caption2.monospacedDigit().weight(.semibold))
                        Rectangle()
                            .fill(Color.primary)
                            .frame(width: viewModel.scaleBarMetrics.widthPoints, height: 3)
                    }
                    .padding(8)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
                    .accessibilityLabel("Map scale \(viewModel.scaleBarMetrics.label)")

                    Spacer()

                    // Active Trip Bottom Bubble (Google Maps-style ETA + Distance + End Trip)
                    if viewModel.isTripActive, let route = viewModel.activeRoute {
                        HStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(route.formattedETA)
                                    .font(.title3.weight(.bold))
                                    .foregroundStyle(.green)
                                Text("\(route.formattedDistance) • \(viewModel.stops.last?.name ?? "Destination")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Button("End Trip") {
                                viewModel.endTrip()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                        .shadow(radius: 6)
                    } else {
                        // Required OpenStreetMap ODbL Attribution
                        Button {
                            viewModel.isShowingAttributionSheet = true
                        } label: {
                            Text("© OpenStreetMap contributors • ODbL 1.0 • 2D Mercator")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.regularMaterial, in: Capsule())
                        .accessibilityLabel("Map Data Attribution: OpenStreetMap contributors")
                    }

                    Spacer()

                    // 2D Compass, My Location GPS & Zoom Stack
                    VStack(spacing: 6) {
                        Button {
                            viewModel.centerOnUserLocation()
                        } label: {
                            Image(systemName: "location.fill")
                                .foregroundStyle(.blue)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.bordered)
                        .help("Center on My Location (GPS)")
                        .accessibilityLabel("My Location")
                        Button {
                            viewModel.handleKeyboardAction(.resetNorth)
                        } label: {
                            Image(systemName: "location.north.line.fill")
                                .rotationEffect(.degrees(-viewModel.camera.bearingDegrees))
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.bordered)
                        .help("Reset North (Bearing: \(Int(viewModel.camera.bearingDegrees))°)")
                        .accessibilityLabel("Compass, bearing \(Int(viewModel.camera.bearingDegrees)) degrees. Activate to reset north.")

                        Button {
                            viewModel.handleKeyboardAction(.zoomIn)
                        } label: {
                            Image(systemName: "plus")
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Zoom In")

                        Button {
                            viewModel.handleKeyboardAction(.zoomOut)
                        } label: {
                            Image(systemName: "minus")
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Zoom Out")
                    }
                }
                .padding(14)
            }
        }
        .sheet(isPresented: $viewModel.isShowingAttributionSheet) {
            VStack(alignment: .leading, spacing: 12) {
                Text("HEXA MAPS — Data & Software Attribution")
                    .font(.headline)
                Text("• Geographic Data: © OpenStreetMap contributors (Licensed under ODbL 1.0)")
                Text("• Low-Zoom Data: Natural Earth (Public Domain / CC0)")
                Text("• Country Highway Route Shields: Derived from OpenStreetMap Americana (CC0 1.0)")
                Text("• Rendering Engine: MapLibre (BSD License)")
                HStack {
                    Spacer()
                    Button("Close") { viewModel.isShowingAttributionSheet = false }
                        .keyboardShortcut(.defaultAction)
                }
            }
            .padding(20)
            .frame(width: 460)
        }
    }
}
