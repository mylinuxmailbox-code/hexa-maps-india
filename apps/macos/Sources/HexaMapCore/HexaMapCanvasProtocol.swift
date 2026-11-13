import Foundation

/// 2D geographic coordinate (WGS84).
/// Strictly 2D-first: altitude/3D camera tilt is excluded from map rendering state.
public struct GeoCoordinate: Equatable, Hashable, Codable, Sendable {
    public let latitude: Double
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = max(-90.0, min(90.0, latitude))
        self.longitude = max(-180.0, min(180.0, longitude))
    }

    /// Default initial pilot coordinate: Bengaluru, India (MG Road / Cubbon Park).
    public static let bengaluruPilot = GeoCoordinate(latitude: 12.9716, longitude: 77.5946)
}

/// Strictly 2D Map Camera State (`pitch` is permanently locked to 0.0 per Project Charter).
public struct MapCameraState: Equatable, Codable, Sendable {
    public var center: GeoCoordinate
    public var zoom: Double
    /// 2D compass rotation in degrees [0, 360).
    public var bearingDegrees: Double
    /// Always 0.0 — 3D globe and 3D pitch are explicitly excluded.
    public var pitchDegrees: Double { 0.0 }

    public init(center: GeoCoordinate, zoom: Double, bearingDegrees: Double = 0.0) {
        self.center = center
        self.zoom = max(0.0, min(22.0, zoom))
        let normalized = bearingDegrees.truncatingRemainder(dividingBy: 360.0)
        self.bearingDegrees = normalized < 0 ? normalized + 360.0 : normalized
    }
}

public enum MapStyleVariant: String, Codable, CaseIterable, Sendable {
    case light2D = "hexa-light-2d"
    case dark2D = "hexa-dark-2d"
    case navigation2D = "hexa-navigation-2d"
}

/// Six-state honest traffic representation.
/// `noData` must never be rendered as green/clear traffic.
public enum HexaTrafficConfidenceState: String, Codable, CaseIterable, Sendable {
    case live = "LIVE"
    case liveLowConfidence = "LIVE_LOW_CONFIDENCE"
    case historical = "HISTORICAL"
    case estimated = "ESTIMATED"
    case stale = "STALE"
    case noData = "NO_DATA"

    public var allowsLiveTrafficColorOverlay: Bool {
        switch self {
        case .live, .liveLowConfidence:
            return true
        case .historical, .estimated, .stale, .noData:
            return false
        }
    }
}

public struct HighwayShieldBadge: Equatable, Codable, Sendable {
    public let countryCode: String
    public let network: String
    public let displayText: String
    public let isFallback: Bool

    public init(countryCode: String, network: String, displayText: String, isFallback: Bool) {
        self.countryCode = countryCode
        self.network = network
        self.displayText = displayText
        self.isFallback = isFallback
    }
}

public struct RenderedRouteSegment: Equatable, Codable, Sendable {
    public let coordinates: [GeoCoordinate]
    public let trafficState: HexaTrafficConfidenceState
    public let speedKph: Double?
    public let highwayShields: [HighwayShieldBadge]

    public init(
        coordinates: [GeoCoordinate],
        trafficState: HexaTrafficConfidenceState,
        speedKph: Double? = nil,
        highwayShields: [HighwayShieldBadge] = []
    ) {
        self.coordinates = coordinates
        self.trafficState = trafficState
        self.speedKph = speedKph
        self.highwayShields = highwayShields
    }
}

/// Renderer-agnostic 2D Map Canvas Protocol (`ADR-0001`).
/// Allows benchmarking MapLibre GL JS in `WKWebView` vs. MapLibre Native AppKit on macOS,
/// while sharing all view models with Phase 2 iOS (`MapLibre Native iOS`).
@MainActor
public protocol HexaMapCanvasProtocol: AnyObject {
    var currentCamera: MapCameraState { get }
    var currentStyle: MapStyleVariant { get }
    var isTrafficOverlayEnabled: Bool { get }

    func setCamera(_ camera: MapCameraState, animated: Bool)
    func setStyle(_ style: MapStyleVariant)
    func setTrafficOverlayEnabled(_ enabled: Bool)
    func setRouteSegments(_ segments: [RenderedRouteSegment])
}
