import Combine
import CoreLocation
import Foundation

/// Desktop keyboard navigation commands required by `docs/01_PRODUCT_REQUIREMENTS.md` Section 2.
public enum MapKeyboardAction: Equatable, Sendable {
    case panNorth
    case panSouth
    case panEast
    case panWest
    case zoomIn
    case zoomOut
    case rotateClockwise
    case rotateCounterClockwise
    case resetNorth
    case toggleTrafficLayer
    case toggleTheme
}

/// Primary Observable ViewModel for the Phase 1 macOS Map Foundation.
/// Enforces:
/// - 2D-only camera state (`pitchDegrees == 0.0`)
/// - Scale bar calculation in metric/imperial units based on latitude & zoom
/// - Honest traffic overlay state and freshness display
/// - Explicit offline vs. live data mode indicator
/// - Full desktop keyboard navigation (`Pan`, `Zoom`, `Rotate`, `Reset North`)
@MainActor
public final class HexaMapViewModel: ObservableObject {
    @Published public private(set) var camera: MapCameraState
    @Published public private(set) var styleVariant: MapStyleVariant
    @Published public private(set) var isTrafficLayerVisible: Bool
    @Published public private(set) var isOfflineModeActive: Bool
    @Published public private(set) var activeTrafficConfidence: HexaTrafficConfidenceState
    @Published public private(set) var trafficLastUpdatedDescription: String
    @Published public private(set) var visibleHighwayShields: [HighwayShieldBadge]
    @Published public private(set) var selectedCoordinateForContextMenu: GeoCoordinate?
    @Published public var searchQuery: String = ""
    @Published public private(set) var searchResults: [HexaPlaceProfile] = []
    @Published public private(set) var allIndiaSearchResults: [AllIndiaSearchResult] = []
    @Published public private(set) var isSearching: Bool = false
    @Published public private(set) var searchErrorMessage: String?
    @Published public private(set) var startPoint: AllIndiaSearchResult?
    @Published public private(set) var stops: [AllIndiaSearchResult] = []
    @Published public private(set) var activeRoute: AllIndiaRouteResult?
    @Published public private(set) var isCalculatingRoute: Bool = false
    @Published public private(set) var isTripActive: Bool = false
    @Published public private(set) var userLocation: GeoCoordinate?
    @Published public private(set) var selectedPlace: HexaPlaceProfile?
    @Published public private(set) var recentSearches: [String] = []
    @Published public var isShowingAttributionSheet: Bool = false
    @Published public var isShowingLegend: Bool = false

    private let searchEngine = HexaSearchAndPlaceEngine()
    private let networkService = HexaAllIndiaNetworkService()
    private let locationManager = CLLocationManager()
    private weak var canvas: (any HexaMapCanvasProtocol)?

    public init(
        initialCamera: MapCameraState = MapCameraState(center: .bengaluruPilot, zoom: 12.5, bearingDegrees: 0.0),
        styleVariant: MapStyleVariant = .light2D,
        isOfflineModeActive: Bool = false
    ) {
        self.camera = initialCamera
        self.styleVariant = styleVariant
        self.isTrafficLayerVisible = true
        self.isOfflineModeActive = isOfflineModeActive
        // Honest default: until >= 5 live probes are observed, state is NO_DATA (never fake green LIVE)
        self.activeTrafficConfidence = .noData
        self.trafficLastUpdatedDescription = "No live probe coverage in viewport"
        self.visibleHighwayShields = [
            HighwayShieldBadge(countryCode: "IN", network: "IN:NH", displayText: "NH 44", isFallback: false),
            HighwayShieldBadge(countryCode: "IN", network: "IN:NH", displayText: "NH 48", isFallback: false),
            HighwayShieldBadge(countryCode: "IN", network: "IN:SH:KA", displayText: "SH 35", isFallback: false),
            HighwayShieldBadge(countryCode: "IN", network: "IN:NE", displayText: "NE 7", isFallback: false)
        ]
        self.locationManager.desiredAccuracy = kCLLocationAccuracyBest
        self.locationManager.requestWhenInUseAuthorization()
        self.locationManager.startUpdatingLocation()
        if let loc = locationManager.location {
            self.userLocation = GeoCoordinate(latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude)
        }
    }

    public func attachCanvas(_ canvas: any HexaMapCanvasProtocol) {
        self.canvas = canvas
        canvas.setStyle(styleVariant)
        canvas.setCamera(camera, animated: false)
        canvas.setTrafficOverlayEnabled(isTrafficLayerVisible)
    }

    public func handleKeyboardAction(_ action: MapKeyboardAction) {
        let panStepDegrees = 0.05 / pow(2.0, max(0.0, camera.zoom - 10.0))
        switch action {
        case .panNorth:
            setCamera(
                MapCameraState(
                    center: GeoCoordinate(latitude: camera.center.latitude + panStepDegrees, longitude: camera.center.longitude),
                    zoom: camera.zoom,
                    bearingDegrees: camera.bearingDegrees
                )
            )
        case .panSouth:
            setCamera(
                MapCameraState(
                    center: GeoCoordinate(latitude: camera.center.latitude - panStepDegrees, longitude: camera.center.longitude),
                    zoom: camera.zoom,
                    bearingDegrees: camera.bearingDegrees
                )
            )
        case .panEast:
            setCamera(
                MapCameraState(
                    center: GeoCoordinate(latitude: camera.center.latitude, longitude: camera.center.longitude + panStepDegrees),
                    zoom: camera.zoom,
                    bearingDegrees: camera.bearingDegrees
                )
            )
        case .panWest:
            setCamera(
                MapCameraState(
                    center: GeoCoordinate(latitude: camera.center.latitude, longitude: camera.center.longitude - panStepDegrees),
                    zoom: camera.zoom,
                    bearingDegrees: camera.bearingDegrees
                )
            )
        case .zoomIn:
            setCamera(MapCameraState(center: camera.center, zoom: camera.zoom + 1.0, bearingDegrees: camera.bearingDegrees))
        case .zoomOut:
            setCamera(MapCameraState(center: camera.center, zoom: camera.zoom - 1.0, bearingDegrees: camera.bearingDegrees))
        case .rotateClockwise:
            setCamera(MapCameraState(center: camera.center, zoom: camera.zoom, bearingDegrees: camera.bearingDegrees + 15.0))
        case .rotateCounterClockwise:
            setCamera(MapCameraState(center: camera.center, zoom: camera.zoom, bearingDegrees: camera.bearingDegrees - 15.0))
        case .resetNorth:
            setCamera(MapCameraState(center: camera.center, zoom: camera.zoom, bearingDegrees: 0.0))
        case .toggleTrafficLayer:
            setTrafficLayerVisible(!isTrafficLayerVisible)
        case .toggleTheme:
            setStyleVariant(styleVariant == .light2D ? .dark2D : .light2D)
        }
    }

    public func setCamera(_ newCamera: MapCameraState, animated: Bool = true) {
        self.camera = newCamera
        canvas?.setCamera(newCamera, animated: animated)
    }

    public func setStyleVariant(_ variant: MapStyleVariant) {
        self.styleVariant = variant
        canvas?.setStyle(variant)
    }

    public func setTrafficLayerVisible(_ visible: Bool) {
        self.isTrafficLayerVisible = visible
        canvas?.setTrafficOverlayEnabled(visible)
    }

    public func setOfflineMode(_ offline: Bool) {
        self.isOfflineModeActive = offline
        if offline {
            // In offline mode, live traffic is unavailable; visibly distinguish cached state
            self.activeTrafficConfidence = .historical
            self.trafficLastUpdatedDescription = "Offline Mode — Using cached regional map & historical speeds"
        }
    }

    public func updateTrafficStatus(state: HexaTrafficConfidenceState, freshnessLabel: String) {
        self.activeTrafficConfidence = state
        self.trafficLastUpdatedDescription = freshnessLabel
    }

    public func openContextMenu(at coordinate: GeoCoordinate) {
        self.selectedCoordinateForContextMenu = coordinate
        self.selectedPlace = searchEngine.reverseGeocode(at: coordinate)
    }

    /// Executes anonymous-first autocomplete / category search without requiring a user account.
    public func performSearch(query: String, category: HexaPlaceCategory? = nil) {
        self.searchQuery = query
        self.searchResults = searchEngine.search(
            query: query,
            near: camera.center,
            categoryFilter: category,
            isOfflineMode: isOfflineModeActive
        )
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty && !recentSearches.contains(trimmed) {
            recentSearches.insert(trimmed, at: 0)
            if recentSearches.count > 10 {
                recentSearches.removeLast()
            }
        }
    }

    public func selectPlace(_ place: HexaPlaceProfile) {
        self.selectedPlace = place
        setCamera(MapCameraState(center: place.coordinate, zoom: max(camera.zoom, 15.0), bearingDegrees: camera.bearingDegrees))
    }

    /// Executes live All-India search via Photon OSM.
    public func runAllIndiaSearch() async {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            self.allIndiaSearchResults = []
            return
        }
        self.isSearching = true
        self.searchErrorMessage = nil
        do {
            let results = try await networkService.searchAllIndia(query: trimmed)
            self.allIndiaSearchResults = results
        } catch {
            self.searchErrorMessage = "Search failed: \(error.localizedDescription)"
        }
        self.isSearching = false
    }

    public func selectAllIndiaResult(_ result: AllIndiaSearchResult) {
        setCamera(MapCameraState(center: result.coordinate, zoom: 14.0, bearingDegrees: 0.0))
        if startPoint == nil {
            startPoint = result
        } else {
            stops.append(result)
        }
        allIndiaSearchResults = []
    }

    public func setAsStart(_ result: AllIndiaSearchResult) {
        startPoint = result
        allIndiaSearchResults = []
        setCamera(MapCameraState(center: result.coordinate, zoom: 13.5, bearingDegrees: 0.0))
    }

    public func addStop(_ result: AllIndiaSearchResult) {
        stops.append(result)
        allIndiaSearchResults = []
        setCamera(MapCameraState(center: result.coordinate, zoom: 13.5, bearingDegrees: 0.0))
    }

    public func removeStop(at index: Int) {
        guard stops.indices.contains(index) else { return }
        stops.remove(at: index)
    }

    public func centerOnUserLocation() {
        locationManager.requestWhenInUseAuthorization()
        locationManager.startUpdatingLocation()
        if let loc = locationManager.location {
            let coord = GeoCoordinate(latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude)
            self.userLocation = coord
            setCamera(MapCameraState(center: coord, zoom: 15.0, bearingDegrees: 0.0), animated: true)
            if let webCanvas = canvas as? HexaWKWebViewMapCanvas {
                webCanvas.setUserLocation(coord)
            }
        } else {
            // Fallback to Bengaluru pilot center if macOS Location Services is disabled
            let fallback = GeoCoordinate.bengaluruPilot
            self.userLocation = fallback
            setCamera(MapCameraState(center: fallback, zoom: 14.5, bearingDegrees: 0.0), animated: true)
            if let webCanvas = canvas as? HexaWKWebViewMapCanvas {
                webCanvas.setUserLocation(fallback)
            }
        }
    }

    public func calculateAllIndiaRoute() async {
        guard let start = startPoint, !stops.isEmpty else { return }
        isCalculatingRoute = true
        searchErrorMessage = nil
        do {
            let waypoints = [start.coordinate] + stops.map(\.coordinate)
            let route = try await networkService.calculateRoute(waypoints: waypoints)
            self.activeRoute = route
            let segment = RenderedRouteSegment(
                coordinates: route.coordinates,
                trafficState: .estimated
            )
            canvas?.setRouteSegments([segment])
            setCamera(MapCameraState(center: start.coordinate, zoom: 11.5, bearingDegrees: 0.0))
        } catch {
            searchErrorMessage = "Route failed: \(error.localizedDescription)"
        }
        isCalculatingRoute = false
    }

    public func startTrip() {
        guard activeRoute != nil else { return }
        isTripActive = true
        allIndiaSearchResults = []
        let target = userLocation ?? startPoint?.coordinate ?? camera.center
        if let webCanvas = canvas as? HexaWKWebViewMapCanvas {
            webCanvas.setUserLocation(target)
        }
        // Smooth Google Maps-style zoom-in motion when starting trip
        setCamera(MapCameraState(center: target, zoom: 16.5, bearingDegrees: 0.0), animated: true)
    }

    public func endTrip() {
        isTripActive = false
        if let start = startPoint {
            setCamera(MapCameraState(center: start.coordinate, zoom: 12.0, bearingDegrees: 0.0), animated: true)
        }
    }

    public func clearRoute() {
        isTripActive = false
        activeRoute = nil
        startPoint = nil
        stops = []
        canvas?.setRouteSegments([])
    }

    /// Computes ground resolution in meters per pixel at the current latitude and zoom level (512px tile basis)
    /// for rendering an accurate 2D map scale bar.
    public var metersPerPixelAtCenter: Double {
        let earthCircumferenceMeters = 40_075_016.686
        let latRadians = camera.center.latitude * .pi / 180.0
        return (earthCircumferenceMeters * cos(latRadians)) / (512.0 * pow(2.0, camera.zoom))
    }

    /// Computes a clean human-readable scale bar distance (e.g., "500 m" or "2 km") and pixel width.
    public var scaleBarMetrics: (label: String, widthPoints: Double) {
        let targetWidthPoints = 100.0
        let rawMeters = metersPerPixelAtCenter * targetWidthPoints
        let niceSteps: [Double] = [
            10, 20, 50, 100, 200, 500,
            1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000
        ]
        let chosenMeters = niceSteps.last(where: { $0 <= rawMeters }) ?? niceSteps[0]
        let widthPoints = max(36.0, min(160.0, chosenMeters / max(0.0001, metersPerPixelAtCenter)))
        let label = chosenMeters >= 1_000
            ? "\(Int(chosenMeters / 1_000)) km"
            : "\(Int(chosenMeters)) m"
        return (label: label, widthPoints: widthPoints)
    }
}
