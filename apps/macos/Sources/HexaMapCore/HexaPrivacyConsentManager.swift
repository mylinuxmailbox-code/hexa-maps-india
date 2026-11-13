import Combine
import Foundation

/// Enforces `docs/07_SECURITY_AND_PRIVACY.md` & `Gate 6` on-device privacy rules:
/// - Location contribution is explicitly opt-in (off by default).
/// - Background location contribution requires a separate explicit permission.
/// - Live location sharing is separately enabled and strictly time-boxed.
/// - Personal Timeline is off by default.
/// - Ephemeral session token rotates every 15 minutes (900s) OR 10 km (10,000m).
/// - Clear pause, revoke, and instant deletion controls.
@MainActor
public final class HexaPrivacyConsentManager: ObservableObject {
    public static let maxSessionDurationSeconds: Int = 900
    public static let maxSessionDistanceMeters: Double = 10_000.0

    @Published public private(set) var foregroundLocationEnabled: Bool = false
    @Published public private(set) var foregroundTrafficOptIn: Bool = false
    @Published public private(set) var backgroundTrafficOptIn: Bool = false
    @Published public private(set) var liveLocationSharingEnabled: Bool = false
    @Published public private(set) var liveLocationSharingExpiresAtEpoch: Int?
    @Published public private(set) var personalTimelineEnabled: Bool = false
    @Published public private(set) var isContributionPaused: Bool = false

    public private(set) var activeEphemeralSessionId: String?
    public private(set) var sessionCreatedAtEpoch: Int = 0
    public private(set) var sessionDistanceMeters: Double = 0.0
    private var lastSubmittedCoord: GeoCoordinate?

    public init() {}

    public func configurePermissions(
        foregroundLocation: Bool? = nil,
        foregroundTraffic: Bool? = nil,
        backgroundTraffic: Bool? = nil,
        liveSharingDurationSeconds: Int? = nil,
        personalTimeline: Bool? = nil,
        nowEpoch: Int = Int(Date().timeIntervalSince1970)
    ) {
        if let foregroundLocation {
            self.foregroundLocationEnabled = foregroundLocation
        }
        if let foregroundTraffic {
            self.foregroundTrafficOptIn = self.foregroundLocationEnabled && foregroundTraffic
        }
        if let backgroundTraffic {
            self.backgroundTrafficOptIn = self.foregroundTrafficOptIn && backgroundTraffic
        }
        if !self.foregroundLocationEnabled {
            self.foregroundTrafficOptIn = false
            self.backgroundTrafficOptIn = false
        }
        if let duration = liveSharingDurationSeconds, duration > 0 {
            let capped = min(86_400, duration)
            self.liveLocationSharingEnabled = true
            self.liveLocationSharingExpiresAtEpoch = nowEpoch + capped
        }
        if let personalTimeline {
            self.personalTimelineEnabled = personalTimeline
        }
    }

    public func pauseTrafficContributions() {
        self.isContributionPaused = true
        self.activeEphemeralSessionId = nil
    }

    public func resumeTrafficContributions() {
        self.isContributionPaused = false
    }

    /// One-tap emergency kill switch: revokes all permissions and purges ephemeral token & trajectory state.
    public func revokeAllAndDeleteLocalHistory() {
        self.foregroundLocationEnabled = false
        self.foregroundTrafficOptIn = false
        self.backgroundTrafficOptIn = false
        self.liveLocationSharingEnabled = false
        self.liveLocationSharingExpiresAtEpoch = nil
        self.personalTimelineEnabled = false
        self.isContributionPaused = false
        self.activeEphemeralSessionId = nil
        self.sessionCreatedAtEpoch = 0
        self.sessionDistanceMeters = 0.0
        self.lastSubmittedCoord = nil
    }

    /// Returns the active ephemeral session ID for a probe coordinate, rotating automatically
    /// after 15 minutes (900s) OR 10 km (10,000m) traveled. Returns `nil` if not opted-in.
    public func ephemeralSessionForProbe(
        at coordinate: GeoCoordinate,
        isBackground: Bool = false,
        nowEpoch: Int = Int(Date().timeIntervalSince1970)
    ) -> String? {
        guard !isContributionPaused, foregroundLocationEnabled, foregroundTrafficOptIn else {
            return nil
        }
        if isBackground && !backgroundTrafficOptIn {
            return nil
        }

        var stepMeters = 0.0
        if let prev = lastSubmittedCoord {
            stepMeters = HexaSearchAndPlaceEngine.haversineMeters(prev, coordinate)
        }

        let ageSeconds = nowEpoch - sessionCreatedAtEpoch
        let projectedMeters = sessionDistanceMeters + stepMeters

        if activeEphemeralSessionId == nil ||
            ageSeconds >= Self.maxSessionDurationSeconds ||
            projectedMeters >= Self.maxSessionDistanceMeters {
            activeEphemeralSessionId = "eph-\(UUID().uuidString.lowercased())"
            sessionCreatedAtEpoch = nowEpoch
            sessionDistanceMeters = 0.0
        } else {
            sessionDistanceMeters = projectedMeters
        }

        lastSubmittedCoord = coordinate
        return activeEphemeralSessionId
    }
}
