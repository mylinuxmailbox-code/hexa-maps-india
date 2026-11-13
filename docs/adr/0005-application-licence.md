# ADR-0005: Application & Package Licensing Strategy

- **Status:** Proposed (Awaiting Final User Selection)
- **Date:** 2026-11-13
- **Deciders:** HEXA Project Owner & Architecture Team

## Context

HEXA MAPS is an open-source, self-hostable mapping ecosystem distributed across macOS, iOS (App Store), Android (Play Store / F-Droid), Web, and Docker containers. The licence must be compatible with Apple App Store distribution, permissive upstream libraries (MapLibre BSD, Valhalla MIT, Photon Apache-2.0, Americana CC0), and our goal of fostering an open ecosystem.

## Options Considered

1. **Option 1: Permissive — Apache License 2.0 (Recommended for Core SDKs / Client Apps) or MIT**
   - *Pros:* Maximum adoption; explicit patent grant (Apache-2.0); zero friction with Apple iOS/macOS App Store static linking rules; matches Planetiler, Martin, Photon, and SeaweedFS.
   - *Cons:* Allows proprietary forks without requiring upstream contribution of modifications.
2. **Option 2: Weak Copyleft — Mozilla Public License 2.0 (MPL-2.0)**
   - *Pros:* File-level copyleft requires modifications to HEXA source files to remain open-source, while explicitly permitting static/dynamic linking into iOS/macOS App Store binaries without DRM conflicts.
   - *Cons:* Slightly more compliance review required for enterprise adopters than Apache-2.0.
3. **Option 3: Strong Network Copyleft — GNU AGPLv3 (Backend Only) + Apache-2.0/MPL-2.0 (Clients)**
   - *Pros:* Prevents cloud vendors from offering a closed-source hosted "HEXA Cloud" without releasing backend modifications.
   - *Cons:* Strictly incompatible with Apple iOS App Store distribution if applied to client code unless dual-licensed or split cleanly between client and server.

## Provisional Recommendation

Adopt **Apache License 2.0** (or **MPL-2.0** if file-level copyleft is desired) across the entire repository for simplicity and App Store compatibility, while keeping all geographic produced works and aggregated traffic extracts under **ODbL 1.0 / CC-BY-4.0**. (Flagged in Unresolved Decisions for final confirmation.)
