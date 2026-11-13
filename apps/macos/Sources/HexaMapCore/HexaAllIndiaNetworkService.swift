import Foundation

public struct AllIndiaSearchResult: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let subtitle: String
    public let coordinate: GeoCoordinate

    public init(id: String, name: String, subtitle: String, coordinate: GeoCoordinate) {
        self.id = id
        self.name = name
        self.subtitle = subtitle
        self.coordinate = coordinate
    }
}

public struct AllIndiaRouteResult: Equatable, Sendable {
    public let coordinates: [GeoCoordinate]
    public let distanceMeters: Double
    public let durationSeconds: Double
    public let summary: String

    public var formattedDistance: String {
        if distanceMeters >= 1000 {
            return String(format: "%.1f km", distanceMeters / 1000.0)
        }
        return "\(Int(distanceMeters.rounded())) m"
    }

    public var formattedETA: String {
        let totalMinutes = max(1, Int((durationSeconds / 60.0).rounded()))
        let hours = totalMinutes / 60
        let mins = totalMinutes % 60
        if hours > 0 {
            return "\(hours) hr \(mins) min"
        }
        return "\(mins) min"
    }
}

/// Open-source All-India Search (Photon OSM) & Routing/ETA (OSRM OSM) client.
/// Zero paid APIs required.
public final class HexaAllIndiaNetworkService: Sendable {
    public init() {}

    /// Searches anywhere in India using Photon (`photon.komoot.io`) biased to India's bounding box.
    public func searchAllIndia(query: String) async throws -> [AllIndiaSearchResult] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        var components = URLComponents(string: "https://photon.komoot.io/api/")!
        components.queryItems = [
            URLQueryItem(name: "q", value: trimmed),
            URLQueryItem(name: "limit", value: "8"),
            URLQueryItem(name: "lat", value: "20.5937"),
            URLQueryItem(name: "lon", value: "78.9629"),
            URLQueryItem(name: "bbox", value: "68.1,6.5,97.4,35.5")
        ]

        guard let url = components.url else { return [] }
        let (data, _) = try await URLSession.shared.data(from: url)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else {
            return []
        }

        var results: [AllIndiaSearchResult] = []
        for (idx, feature) in features.enumerated() {
            guard let geometry = feature["geometry"] as? [String: Any],
                  let coords = geometry["coordinates"] as? [Double],
                  coords.count >= 2,
                  let props = feature["properties"] as? [String: Any] else {
                continue
            }

            let name = (props["name"] as? String)
                ?? (props["street"] as? String)
                ?? (props["city"] as? String)
                ?? trimmed

            let subtitleParts = [
                props["street"] as? String,
                props["city"] as? String,
                props["state"] as? String,
                props["country"] as? String
            ].compactMap { $0 }

            let subtitle = subtitleParts.isEmpty ? "India" : subtitleParts.joined(separator: ", ")
            let osmId = props["osm_id"].map { "\($0)" } ?? "\(idx)"

            results.append(
                AllIndiaSearchResult(
                    id: "photon-\(osmId)-\(idx)",
                    name: name,
                    subtitle: subtitle,
                    coordinate: GeoCoordinate(latitude: coords[1], longitude: coords[0])
                )
            )
        }
        return results
    }

    /// Calculates a multi-stop driving route and ETA across any number of waypoints (Start -> Stops...) in India using OSM OSRM.
    public func calculateRoute(waypoints: [GeoCoordinate]) async throws -> AllIndiaRouteResult {
        guard waypoints.count >= 2 else {
            throw URLError(.badURL)
        }
        let coordString = waypoints.map { "\($0.longitude),\($0.latitude)" }.joined(separator: ";")
        let urlString = "https://router.project-osrm.org/route/v1/driving/\(coordString)?overview=full&geometries=geojson"
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }

        let (data, _) = try await URLSession.shared.data(from: url)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let routes = json["routes"] as? [[String: Any]],
              let first = routes.first,
              let geometry = first["geometry"] as? [String: Any],
              let coords = geometry["coordinates"] as? [[Double]] else {
            throw URLError(.cannotParseResponse)
        }

        let distance = (first["distance"] as? Double) ?? 0.0
        let duration = (first["duration"] as? Double) ?? 0.0
        let routeCoords = coords.compactMap { pair -> GeoCoordinate? in
            guard pair.count >= 2 else { return nil }
            return GeoCoordinate(latitude: pair[1], longitude: pair[0])
        }

        return AllIndiaRouteResult(
            coordinates: routeCoords,
            distanceMeters: distance,
            durationSeconds: duration,
            summary: "Via OpenStreetMap Roads"
        )
    }
}
