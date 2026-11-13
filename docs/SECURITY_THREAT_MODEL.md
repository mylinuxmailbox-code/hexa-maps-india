# HEXA MAPS — Security & Privacy Threat Model

**Status:** Gate 0 Baseline (Must be re-verified at Gate 6 before live traffic pilot)
**Core Principle:** Precise location data reveals where a person lives, works, worships, seeks healthcare, and associates. HEXA MAPS treats raw location data as a toxic asset that must be minimized, stripped of identity, and aggregated as early as possible.

---

## 1. Assets & Trust Boundaries

### Sensitive Assets
1. **Real-Time User Coordinates:** Instantaneous GPS position during map browsing, navigation, or location sharing.
2. **Traffic Probe Trajectories:** Short sequences of `(lat, lon, timestamp, bearing, speed)` submitted by opt-in contributors.
3. **Live Location Sharing Sessions:** Time-bounded streams shared intentionally with friends/family.
4. **Saved Places & Personal Timeline:** Home/Work markers, custom lists, and optional local trip history.
5. **User-Generated Content (UGC) & Media:** Place reviews, uploaded photos (containing potential EXIF metadata, faces, and license plates), and road incident reports.
6. **Routing Graph & Live Traffic Integrity (`traffic.tar`):** The authoritative road speed state affecting ETA and navigation across all users.

### Trust Boundaries
- **Boundary 1: Client Device (macOS / iOS / Android / Web)** — Trusted by the local user; untrusted by the HEXA server (can be emulated or rooted by an attacker).
- **Boundary 2: Public Edge / Ingestion API** — Exposed to TLS traffic from anonymous and authenticated clients.
- **Boundary 3: Ephemeral Traffic Processing Pipeline (NATS → Privacy Filter → Valhalla Meili)** — High-sensitivity in-memory processing zone; zero disk persistence of raw probe traces.
- **Boundary 4: Persistent Storage (PostGIS / SeaweedFS)** — Only stores aggregated edge speeds ($k \ge 5$), anonymized incident reports, public place data, and explicitly saved user account artifacts.

---

## 2. STRIDE & Privacy Threat Matrix

### 2.1 Location Collection & Traffic Contributions

| Threat | Attack Vector | Mitigation & Architectural Control |
| :--- | :--- | :--- |
| **Home/Work Re-Identification from Traffic Probes** | Adversary or database compromise inspects start/end points of GPS probe traces to deduce where a contributor lives or works. | 1. **On-Device & Edge Geofence Clipping:** Automatically discard the first **500m** and last **500m** of every movement trajectory plus a random uniform jitter of **100m–300m** before transmission.<br>2. **Zero Raw Probe Persistence:** Raw probes exist only in volatile memory/short-TTL NATS stream (< 5 min) for Valhalla Meili map-matching and are immediately discarded after directed-edge speed extraction. |
| **Longitudinal Tracking via Stable Identifiers** | Server links Tuesday's morning commute to Wednesday's evening trip using a device UUID, account token, or IP address. | 1. **Decoupled Ingestion:** Traffic probe ingestion endpoint (`/api/v1/traffic/probes`) **forbids** user account tokens.<br>2. **Ephemeral Rotating Tokens:** Clients generate short-lived blind/ephemeral session IDs rotated every **15 minutes** or every **10 km** traveled.<br>3. **IP Stripping:** Reverse proxy strips client IP before forwarding probe payloads to NATS; subnet rate-limiting uses a salted rotating 5-minute bloom filter in memory. |
| **Low-Density Road Inference ($k$-Anonymity Violation)** | Only 1 car drives down a rural lane at 02:00 AM; publishing a `LIVE` speed on that road segment reveals that a vehicle just passed. | **Hard $k$-Anonymity Gate ($k \ge 5$):** `traffic-publishing` refuses to publish `LIVE` or `LIVE_LOW_CONFIDENCE` speeds for any `directed_edge_id` unless at least **5 distinct ephemeral sessions** contributed valid observations within the rolling aggregation window. Below $k=5$, the edge strictly reports `NO_DATA` or falls back to static `HISTORICAL`/`ESTIMATED` speed. |
| **GPS Spoofing, Replay & Sybil Congestion ("99 Phones in a Wagon")** | Attacker scripts fake HTTP requests with low speeds on a major highway (e.g., Bengaluru ORR) to fabricate a traffic jam and force rerouting. | 1. **Kinematic & Topological Validation:** Reject probes with impossible acceleration ($> 8\text{ m/s}^2$), teleportation, or high map-matching distance residuals ($> 25\text{ m}$ from OSM road centerline).<br>2. **Shockwave Consistency Check:** Flag sudden speed drops on a single edge if adjacent upstream/downstream directed edges and cross-subnet contributors show normal free-flow.<br>3. **Per-Subnet Contribution Cap:** Limit maximum effective weight of probes originating from the same `/24` IPv4 or `/48` IPv6 prefix within any 5-minute bucket. |
| **Accidental Coordinate Leakage in Application Logs** | Exception stack traces, HTTP access logs, or OpenTelemetry spans log query strings like `?lat=12.9716&lon=77.5946`. | 1. **POST Bodies for Coordinates:** Routing, reverse geocoding, and probe endpoints pass coordinates in request bodies or redacted headers, or use custom Fastify log redaction serializers that scrub `lat`, `lon`, `coordinates`, `bbox`, and `trace` fields.<br>2. **Automated CI Log Test:** Integration tests assert that running search, routing, and probe ingestion writes zero coordinate regex matches to stdout/log files. |

---

### 2.2 Location Sharing & Personal Features

| Threat | Attack Vector | Mitigation & Architectural Control |
| :--- | :--- | :--- |
| **Stalking / Unnoticed Background Sharing** | Abusive partner enables location sharing or background contribution on user's device without ongoing awareness. | 1. **Three-Tier Explicit Opt-In:** (a) Foreground map location, (b) Background traffic contribution, and (c) Live location sharing require separate, explicit opt-in switches.<br>2. **Mandatory Expiry & Persistent Notification:** Live location sharing defaults to time-bounded sessions (15m, 1h, 8h—never infinite by default) with a persistent OS notification and one-tap **Stop All Sharing** kill switch.<br>3. **Personal Timeline Off by Default:** When enabled, personal Timeline is stored in an encrypted local SQLite database on-device (`SQLCipher`), never synced to the server unless the user explicitly configures encrypted backup. |
| **Leaked Location-Share Capability Links** | Share URL is guessed, indexed, or forwarded after the trip ends. | 1. **High-Entropy Capability URLs + Ephemeral Keys:** Share URLs use 256-bit cryptographic tokens (`#key=...` fragment for E2EE payload decryption so the server only relays ciphertext).<br>2. **Instant Revocation:** Revoking or expiring a session immediately deletes the server relay channel and invalidates the token. |

---

### 2.3 User Photos, Reviews, Incident Reports & Admin Access

| Threat | Attack Vector | Mitigation & Architectural Control |
| :--- | :--- | :--- |
| **EXIF Metadata & Bystander Privacy in Street/Place Photos** | Uploaded photo leaks user's home GPS timestamp, camera serial number, or unblurred bystander faces and vehicle license plates. | 1. **Mandatory EXIF Scrubbing:** `media` ingestion pipeline strips all EXIF/XMP metadata (retaining only sanitized capture orientation and coarse place/street link if explicitly submitted).<br>2. **Face & License Plate Blurring:** Street-level imagery goes through automated computer-vision blurring (via Panoramax / YOLO privacy pipeline) before public publication. |
| **Malicious Incident Reports (Fake Road Closures)** | Attacker submits fake "Road Closed" or "Flood" reports to disrupt routing. | 1. **Corroboration Threshold:** Unverified community road closures display as informational warnings first; they do not hard-block Valhalla routing unless corroborated by multiple independent contributors, live traffic speed drop ($v \approx 0$), or an authenticated municipal/moderator feed. |
| **AI Provider Data Leakage** | User uses optional natural-language search and their precise location history or private saved places are sent to an external LLM API. | 1. **Strict Context Minimization:** The `AIProvider` adapter never receives personal Timeline, account identity, or background location history—only the current viewport bounding box (rounded to ~1 km precision) and the explicit text query.<br>2. **Server-Side Secrets Only:** No AI API keys are ever bundled into client applications. |
| **Administrative Compromise** | Attacker gains access to admin dashboard to poison map data or inspect user records. | 1. **Keycloak RBAC + MFA:** Admin endpoints require OIDC MFA claims and hardware-key/TOTP verification.<br>2. **Immutable Audit Log:** Every administrative action (moderation, graph publish, closure override) is recorded in an append-only audit table. |
