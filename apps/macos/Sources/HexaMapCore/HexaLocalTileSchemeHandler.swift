import Foundation
import WebKit

/// Custom `WKURLSchemeHandler` that serves local `.pmtiles` byte-range requests,
/// MapLibre style JSON, and country-specific highway shield sprites (`hexa-tiles://`)
/// directly in-process without opening a local TCP port or requiring network access.
public final class HexaLocalTileSchemeHandler: NSObject, WKURLSchemeHandler {
    public static let scheme = "hexa-tiles"

    private let tileDirectory: URL

    public init(tileDirectory: URL) {
        self.tileDirectory = tileDirectory
        super.init()
    }

    public func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        // Prevent path traversal outside tileDirectory
        let relativePath = requestURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if relativePath.contains("..") {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        // Built-in synthetic health/style endpoint for Gate 1 spike verification
        if requestURL.host == "style" {
            let styleJSON = Self.build2DStyleJSON(variant: relativePath.isEmpty ? "hexa-light-2d" : relativePath)
            let data = Data(styleJSON.utf8)
            let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": "application/json",
                    "Content-Length": "\(data.count)",
                    "Access-Control-Allow-Origin": "*"
                ]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
            return
        }

        let fileURL = tileDirectory.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        do {
            let fullData = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let rangeHeader = urlSchemeTask.request.value(forHTTPHeaderField: "Range")
            if let rangeHeader, let (start, end) = Self.parseByteRange(header: rangeHeader, totalLength: fullData.count) {
                let slice = fullData.subdata(in: start..<(end + 1))
                let response = HTTPURLResponse(
                    url: requestURL,
                    statusCode: 206,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": "application/octet-stream",
                        "Content-Length": "\(slice.count)",
                        "Content-Range": "bytes \(start)-\(end)/\(fullData.count)",
                        "Accept-Ranges": "bytes",
                        "Access-Control-Allow-Origin": "*"
                    ]
                )!
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(slice)
                urlSchemeTask.didFinish()
            } else {
                let response = HTTPURLResponse(
                    url: requestURL,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": "application/octet-stream",
                        "Content-Length": "\(fullData.count)",
                        "Accept-Ranges": "bytes",
                        "Access-Control-Allow-Origin": "*"
                    ]
                )!
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(fullData)
                urlSchemeTask.didFinish()
            }
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        // No-op for synchronous memory-mapped reads
    }

    /// Parses an HTTP `Range: bytes=start-end` header for PMTiles random access.
    public static func parseByteRange(header: String, totalLength: Int) -> (Int, Int)? {
        guard totalLength > 0, header.hasPrefix("bytes=") else { return nil }
        let parts = header.dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, let start = Int(parts[0]) else { return nil }
        let end = parts[1].isEmpty ? (totalLength - 1) : (Int(parts[1]) ?? (totalLength - 1))
        guard start >= 0, end >= start, end < totalLength else { return nil }
        return (start, end)
    }

    /// Generates a strictly 2D MapLibre Style Specification JSON document (`pitch: 0`, flat Mercator).
    public static func build2DStyleJSON(variant: String) -> String {
        let isDark = variant.contains("dark") || variant.contains("navigation")
        let bgColor = isDark ? "#09090B" : "#F8FAFC"
        return """
        {
          "version": 8,
          "name": "\(variant)",
          "pitch": 0,
          "bearing": 0,
          "projection": { "type": "mercator" },
          "sources": {},
          "layers": [
            {
              "id": "background-2d",
              "type": "background",
              "paint": {
                "background-color": "\(bgColor)"
              }
            }
          ]
        }
        """
    }
}
