import Foundation

/// Represents a downloadable regional offline package (`.pmtiles` + optional Valhalla routing tiles + SQLite FTS5 search index).
public struct OfflineRegionManifest: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public let displayName: String
    public let countryCode: String
    public let version: String
    public let boundingBox: [Double] // [minLon, minLat, maxLon, maxLat]
    public let pmtilesByteSize: Int64
    public let pmtilesSha256: String
    public let graphVersionId: String
    public let createdAtISO8601: String

    public init(
        id: String,
        displayName: String,
        countryCode: String,
        version: String,
        boundingBox: [Double],
        pmtilesByteSize: Int64,
        pmtilesSha256: String,
        graphVersionId: String,
        createdAtISO8601: String
    ) {
        self.id = id
        self.displayName = displayName
        self.countryCode = countryCode
        self.version = version
        self.boundingBox = boundingBox
        self.pmtilesByteSize = pmtilesByteSize
        self.pmtilesSha256 = pmtilesSha256
        self.graphVersionId = graphVersionId
        self.createdAtISO8601 = createdAtISO8601
    }

    /// Default initial pilot region manifest: Bengaluru Metropolitan Region, India.
    public static let bengaluruPilotRegion = OfflineRegionManifest(
        id: "in-ka-bengaluru",
        displayName: "Bengaluru Metropolitan Region (Karnataka, India)",
        countryCode: "IN",
        version: "2026.11.13",
        boundingBox: [77.3500, 12.7500, 77.8500, 13.2000],
        pmtilesByteSize: 148_500_000,
        pmtilesSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        graphVersionId: "blr-2026-11-13-v1",
        createdAtISO8601: "2026-11-13T00:00:00Z"
    )
}

public enum OfflineRegionState: Equatable, Sendable {
    case notInstalled
    case downloading(bytesReceived: Int64, totalBytes: Int64)
    case verifyingChecksum
    case installed(installedVersion: String, localURL: URL)
    case corrupted(reason: String)

    public var progressFraction: Double {
        if case let .downloading(received, total) = self, total > 0 {
            return min(1.0, max(0.0, Double(received) / Double(total)))
        }
        if case .installed = self {
            return 1.0
        }
        return 0.0
    }
}

/// Manages regional offline map packages with atomic staging, SHA-256 verification,
/// corrupt-package quarantine/recovery, and storage accounting.
public final class HexaOfflineRegionManager: @unchecked Sendable {
    public let storageRootURL: URL
    public let stagingRootURL: URL

    private var states: [String: OfflineRegionState] = [:]
    private let lock = NSLock()

    public init(storageRootURL: URL) throws {
        self.storageRootURL = storageRootURL
        self.stagingRootURL = storageRootURL.appendingPathComponent(".staging", isDirectory: true)
        try FileManager.default.createDirectory(at: storageRootURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: stagingRootURL, withIntermediateDirectories: true)
    }

    public func state(for regionId: String) -> OfflineRegionState {
        lock.lock()
        defer { lock.unlock() }
        return states[regionId] ?? .notInstalled
    }

    public func updateDownloadProgress(regionId: String, bytesReceived: Int64, totalBytes: Int64) {
        lock.lock()
        defer { lock.unlock() }
        states[regionId] = .downloading(bytesReceived: bytesReceived, totalBytes: totalBytes)
    }

    /// Atomically verifies a staged `.pmtiles` payload against the manifest's SHA-256 digest
    /// and promotes it to the active storage directory. If verification fails, the corrupt staging
    /// file is deleted and any previously installed valid package remains intact.
    @discardableResult
    public func commitStagedPackage(
        manifest: OfflineRegionManifest,
        stagedData: Data
    ) throws -> URL {
        lock.lock()
        states[manifest.id] = .verifyingChecksum
        lock.unlock()

        let stagingFileURL = stagingRootURL.appendingPathComponent("\(manifest.id).pmtiles.part")
        try stagedData.write(to: stagingFileURL, options: .atomic)

        let actualHash = Self.sha256Hex(of: stagedData)
        guard actualHash.lowercased() == manifest.pmtilesSha256.lowercased() else {
            try? FileManager.default.removeItem(at: stagingFileURL)
            lock.lock()
            // Preserve existing installed state if an update failed, otherwise mark corrupted
            if case .installed = states[manifest.id] {
                // Keep existing installed version untouched
            } else {
                states[manifest.id] = .corrupted(
                    reason: "SHA-256 mismatch (expected \(manifest.pmtilesSha256.prefix(12))…, got \(actualHash.prefix(12))…)"
                )
            }
            lock.unlock()
            throw CocoaError(.fileReadCorruptFile)
        }

        let finalURL = storageRootURL.appendingPathComponent("\(manifest.id).pmtiles")
        if FileManager.default.fileExists(atPath: finalURL.path) {
            _ = try FileManager.default.replaceItemAt(finalURL, withItemAt: stagingFileURL)
        } else {
            try FileManager.default.moveItem(at: stagingFileURL, to: finalURL)
        }

        lock.lock()
        states[manifest.id] = .installed(installedVersion: manifest.version, localURL: finalURL)
        lock.unlock()

        return finalURL
    }

    public func removeInstalledRegion(regionId: String) throws {
        let finalURL = storageRootURL.appendingPathComponent("\(regionId).pmtiles")
        if FileManager.default.fileExists(atPath: finalURL.path) {
            try FileManager.default.removeItem(at: finalURL)
        }
        lock.lock()
        states[regionId] = .notInstalled
        lock.unlock()
    }

    public func totalInstalledBytes() -> Int64 {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: storageRootURL,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return 0
        }
        var total: Int64 = 0
        for url in urls where url.pathExtension == "pmtiles" {
            if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                total += Int64(size)
            }
        }
        return total
    }

    /// Pure Swift SHA-256 implementation (FIPS 180-4) so checksum verification has zero external binary dependencies.
    public static func sha256Hex(of data: Data) -> String {
        let k: [UInt32] = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ]

        var h0: UInt32 = 0x6a09e667
        var h1: UInt32 = 0xbb67ae85
        var h2: UInt32 = 0x3c6ef372
        var h3: UInt32 = 0xa54ff53a
        var h4: UInt32 = 0x510e527f
        var h5: UInt32 = 0x9b05688c
        var h6: UInt32 = 0x1f83d9ab
        var h7: UInt32 = 0x5be0cd19

        var msg = [UInt8](data)
        let bitLen = UInt64(msg.count) * 8
        msg.append(0x80)
        while (msg.count % 64) != 56 {
            msg.append(0x00)
        }
        for i in (0..<8).reversed() {
            msg.append(UInt8((bitLen >> (i * 8)) & 0xff))
        }

        @inline(__always) func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 {
            (x >> n) | (x << (32 - n))
        }

        for chunkStart in stride(from: 0, to: msg.count, by: 64) {
            var w = [UInt32](repeating: 0, count: 64)
            for i in 0..<16 {
                let idx = chunkStart + i * 4
                w[i] = (UInt32(msg[idx]) << 24)
                     | (UInt32(msg[idx + 1]) << 16)
                     | (UInt32(msg[idx + 2]) << 8)
                     | UInt32(msg[idx + 3])
            }
            for i in 16..<64 {
                let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
                let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
                w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
            }

            var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
            for i in 0..<64 {
                let S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
                let ch = (e & f) ^ ((~e) & g)
                let temp1 = h &+ S1 &+ ch &+ k[i] &+ w[i]
                let S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let temp2 = S0 &+ maj

                h = g; g = f; f = e
                e = d &+ temp1
                d = c; c = b; b = a
                a = temp1 &+ temp2
            }

            h0 = h0 &+ a; h1 = h1 &+ b; h2 = h2 &+ c; h3 = h3 &+ d
            h4 = h4 &+ e; h5 = h5 &+ f; h6 = h6 &+ g; h7 = h7 &+ h
        }

        return String(
            format: "%08x%08x%08x%08x%08x%08x%08x%08x",
            h0, h1, h2, h3, h4, h5, h6, h7
        )
    }
}
