import Foundation

public enum HexaDataProvenanceSource: String, Codable, Sendable {
    case openStreetMapODbL = "OSM_ODBL"
    case hexaCommunity = "HEXA_COMMUNITY"
}

public enum HexaPlaceCategory: String, Codable, CaseIterable, Sendable {
    case restaurants = "restaurants"
    case cafes = "cafes"
    case hotels = "hotels"
    case shops = "shops"
    case hospitals = "hospitals"
    case pharmacies = "pharmacies"
    case schools = "schools"
    case fuelStations = "fuel_stations"
    case evCharging = "ev_charging"
    case parking = "parking"
    case publicToilets = "public_toilets"
    case drinkingWater = "drinking_water"
    case atms = "atms"
    case transitStations = "transit_stations"
    case touristAttractions = "tourist_attractions"
}

/// Represents a Place & Business Detail Profile (`docs/01_PRODUCT_REQUIREMENTS.md` Section 4).
/// - Never invents missing business fields (optional properties remain `nil` when unverified).
/// - Differentiates `OSM_ODBL` imported data from `HEXA_COMMUNITY` contributions.
public struct HexaPlaceProfile: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let alternateNames: [String]
    public let category: HexaPlaceCategory
    public let formattedAddress: String
    public let coordinate: GeoCoordinate
    public let phone: String?
    public let website: String?
    public let openingHoursRaw: String?
    public let isOpenNow: Bool?
    public let wheelchairAccessible: String?
    public let averageRating: Double?
    public let reviewCount: Int
    public let primarySource: HexaDataProvenanceSource
    public let hasCommunityEnrichment: Bool
    public let lastVerifiedISO8601: String?
    public let isOfflineCachedResult: Bool

    public init(
        id: String,
        name: String,
        alternateNames: [String] = [],
        category: HexaPlaceCategory,
        formattedAddress: String,
        coordinate: GeoCoordinate,
        phone: String? = nil,
        website: String? = nil,
        openingHoursRaw: String? = nil,
        isOpenNow: Bool? = nil,
        wheelchairAccessible: String? = nil,
        averageRating: Double? = nil,
        reviewCount: Int = 0,
        primarySource: HexaDataProvenanceSource = .openStreetMapODbL,
        hasCommunityEnrichment: Bool = false,
        lastVerifiedISO8601: String? = nil,
        isOfflineCachedResult: Bool = false
    ) {
        self.id = id
        self.name = name
        self.alternateNames = alternateNames
        self.category = category
        self.formattedAddress = formattedAddress
        self.coordinate = coordinate
        self.phone = phone
        self.website = website
        self.openingHoursRaw = openingHoursRaw
        self.isOpenNow = isOpenNow
        self.wheelchairAccessible = wheelchairAccessible
        self.averageRating = averageRating
        self.reviewCount = reviewCount
        self.primarySource = primarySource
        self.hasCommunityEnrichment = hasCommunityEnrichment
        self.lastVerifiedISO8601 = lastVerifiedISO8601
        self.isOfflineCachedResult = isOfflineCachedResult
    }
}

/// Local & Online Search, Autocomplete, Category Discovery, and Reverse Geocoding Engine for macOS (`Gate 3`).
/// - Works without requiring a user account.
/// - Deduplicates OSM node/way pairs within 60 meters.
/// - Ranks by prefix/exact match + proximity to current viewport center.
public final class HexaSearchAndPlaceEngine: Sendable {
    private let catalog: [HexaPlaceProfile]

    public init(catalog: [HexaPlaceProfile] = HexaSearchAndPlaceEngine.defaultBengaluruPilotCatalog) {
        self.catalog = catalog
    }

    /// Performs autocomplete / text search with proximity ranking and 60m spatial deduplication.
    public func search(
        query: String,
        near reference: GeoCoordinate,
        categoryFilter: HexaPlaceCategory? = nil,
        isOfflineMode: Bool = false
    ) -> [HexaPlaceProfile] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        let filtered = catalog.filter { place in
            if let categoryFilter, place.category != categoryFilter {
                return false
            }
            if trimmed.isEmpty {
                return true
            }
            let matchesPrimary = place.name.lowercased().contains(trimmed)
            let matchesAlt = place.alternateNames.contains { $0.lowercased().contains(trimmed) }
            let matchesAddr = place.formattedAddress.lowercased().contains(trimmed)
            let matchesCat = place.category.rawValue.replacingOccurrences(of: "_", with: " ").contains(trimmed)
            return matchesPrimary || matchesAlt || matchesAddr || matchesCat
        }

        let scored: [(place: HexaPlaceProfile, score: Double)] = filtered.map { item in
            let nameLower = item.name.lowercased()
            var textScore = 0.5
            if !trimmed.isEmpty {
                if nameLower == trimmed {
                    textScore = 1.0
                } else if nameLower.hasPrefix(trimmed) {
                    textScore = 0.85
                } else if nameLower.contains(trimmed) {
                    textScore = 0.65
                } else {
                    textScore = 0.45
                }
            }
            let distKm = Self.haversineMeters(reference, item.coordinate) / 1_000.0
            let proximityScore = exp(-distKm / 15.0)
            let total = 0.65 * textScore + 0.35 * proximityScore

            let taggedItem = HexaPlaceProfile(
                id: item.id,
                name: item.name,
                alternateNames: item.alternateNames,
                category: item.category,
                formattedAddress: item.formattedAddress,
                coordinate: item.coordinate,
                phone: item.phone,
                website: item.website,
                openingHoursRaw: item.openingHoursRaw,
                isOpenNow: item.isOpenNow,
                wheelchairAccessible: item.wheelchairAccessible,
                averageRating: item.averageRating,
                reviewCount: item.reviewCount,
                primarySource: item.primarySource,
                hasCommunityEnrichment: item.hasCommunityEnrichment,
                lastVerifiedISO8601: item.lastVerifiedISO8601,
                isOfflineCachedResult: isOfflineMode
            )
            return (taggedItem, total)
        }

        let sorted = scored.sorted { $0.score > $1.score }.map(\.place)

        // Spatial + Name Deduplication (collapse duplicate OSM Node + Way within 60m)
        var deduplicated: [HexaPlaceProfile] = []
        for candidate in sorted {
            let isDup = deduplicated.contains { existing in
                existing.name.caseInsensitiveCompare(candidate.name) == .orderedSame &&
                existing.category == candidate.category &&
                Self.haversineMeters(existing.coordinate, candidate.coordinate) <= 60.0
            }
            if !isDup {
                deduplicated.append(candidate)
            }
        }
        return deduplicated
    }

    /// Reverse geocodes a clicked map coordinate ("What's here?") to the nearest known place or coordinate label.
    public func reverseGeocode(at coordinate: GeoCoordinate, maxRadiusMeters: Double = 500.0) -> HexaPlaceProfile {
        if let nearest = catalog.min(by: {
            Self.haversineMeters(coordinate, $0.coordinate) < Self.haversineMeters(coordinate, $1.coordinate)
        }), Self.haversineMeters(coordinate, nearest.coordinate) <= maxRadiusMeters {
            return nearest
        }

        return HexaPlaceProfile(
            id: "coord:\(String(format: "%.5f,%.5f", coordinate.latitude, coordinate.longitude))",
            name: String(format: "%.5f° N, %.5f° E", coordinate.latitude, coordinate.longitude),
            category: .touristAttractions,
            formattedAddress: "Bengaluru Metropolitan Region, Karnataka, India",
            coordinate: coordinate,
            primarySource: .openStreetMapODbL
        )
    }

    public static func haversineMeters(_ a: GeoCoordinate, _ b: GeoCoordinate) -> Double {
        let r = 6_371_000.0
        let dLat = (b.latitude - a.latitude) * .pi / 180.0
        let dLon = (b.longitude - a.longitude) * .pi / 180.0
        let lat1 = a.latitude * .pi / 180.0
        let lat2 = b.latitude * .pi / 180.0
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2.0 * r * asin(min(1.0, sqrt(h)))
    }

    /// Curated Bengaluru Pilot OSM + Community Place Catalog for offline/local search & testing.
    public static let defaultBengaluruPilotCatalog: [HexaPlaceProfile] = [
        HexaPlaceProfile(
            id: "osm:N:10203040",
            name: "Mahatma Gandhi Road Metro Station",
            alternateNames: ["ಮಹಾತ್ಮ ಗಾಂಧಿ ರಸ್ತೆ ಮೆಟ್ರೋ ನಿಲ್ದಾಣ", "MG Road Metro"],
            category: .transitStations,
            formattedAddress: "MG Road, Shivajinagar, Bengaluru 560001",
            coordinate: GeoCoordinate(latitude: 12.9756, longitude: 77.6066),
            openingHoursRaw: "Mo-Su 05:00-23:00",
            isOpenNow: true,
            wheelchairAccessible: "yes",
            primarySource: .openStreetMapODbL,
            lastVerifiedISO8601: "2026-11-01T00:00:00Z"
        ),
        HexaPlaceProfile(
            id: "osm:N:555123",
            name: "MTR 1924 Lalbagh",
            alternateNames: ["Mavalli Tiffin Rooms"],
            category: .restaurants,
            formattedAddress: "14 Lalbagh Road, Bengaluru 560027",
            coordinate: GeoCoordinate(latitude: 12.9552, longitude: 77.5855),
            phone: "+91 80 2222 0022",
            website: "https://www.mavallitiffinrooms.com",
            openingHoursRaw: "Tu-Su 06:30-11:00; Tu-Su 12:30-20:30",
            isOpenNow: true,
            wheelchairAccessible: "limited",
            averageRating: 4.6,
            reviewCount: 18,
            primarySource: .openStreetMapODbL,
            hasCommunityEnrichment: true,
            lastVerifiedISO8601: "2026-11-12T08:00:00Z"
        ),
        HexaPlaceProfile(
            id: "osm:N:1001",
            name: "Bowring and Lady Curzon Hospital",
            category: .hospitals,
            formattedAddress: "Lady Curzon Road, Shivajinagar, Bengaluru 560001",
            coordinate: GeoCoordinate(latitude: 12.9822, longitude: 77.6042),
            openingHoursRaw: "24/7",
            isOpenNow: true,
            wheelchairAccessible: "yes",
            primarySource: .openStreetMapODbL
        ),
        // Intentional duplicate OSM Way centroid 20m away to verify on-device deduplication
        HexaPlaceProfile(
            id: "osm:W:2002",
            name: "Bowring and Lady Curzon Hospital",
            category: .hospitals,
            formattedAddress: "Lady Curzon Road, Shivajinagar, Bengaluru 560001",
            coordinate: GeoCoordinate(latitude: 12.9823, longitude: 77.6043),
            openingHoursRaw: "24/7",
            isOpenNow: true,
            wheelchairAccessible: "yes",
            primarySource: .openStreetMapODbL
        ),
        HexaPlaceProfile(
            id: "osm:N:778899",
            name: "BESCOM EV Fast Charger — Cubbon Park",
            category: .evCharging,
            formattedAddress: "Kasturba Road, Cubbon Park, Bengaluru 560001",
            coordinate: GeoCoordinate(latitude: 12.9763, longitude: 77.5929),
            openingHoursRaw: "24/7",
            isOpenNow: true,
            primarySource: .openStreetMapODbL,
            hasCommunityEnrichment: true,
            lastVerifiedISO8601: "2026-11-10T12:00:00Z"
        )
    ]
}
