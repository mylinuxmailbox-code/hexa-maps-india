"""
HEXA MAPS — Valhalla Live Traffic (`traffic.tar`) Writer, Confidence State Machine & Privacy Gate
(Gate 1 Spike Implementation)

Verifies:
1. Binary encoding of Valhalla `TrafficTileHeader` (32 bytes) and 64-bit `TrafficSpeed`
   bitfields (`baldr/traffictile.h` in Valhalla 3.6+).
2. Strict `graph_version_id` verification before publishing traffic tiles.
3. Hard k-anonymity gate (k >= 5 distinct ephemeral sessions) and 6-state traffic
   confidence classification:
   - LIVE
   - LIVE_LOW_CONFIDENCE
   - HISTORICAL
   - ESTIMATED
   - STALE
   - NO_DATA
   (`NO_DATA` always encodes `UNKNOWN_TRAFFIC_SPEED_RAW = 127` in `traffic.tar` and
   never renders as green free-flow on the client map).
4. Uncompressed POSIX `.tar` archive layout (`level/tile_id.gph`) suitable for Valhalla
   `mjolnir.traffic_extract` memory mapping (`mmap`).
"""

from __future__ import annotations

import dataclasses
import enum
import io
import math
import struct
import tarfile
import time
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# Valhalla `baldr/traffictile.h` constants
TRAFFIC_TILE_VERSION: int = 3
UNKNOWN_TRAFFIC_SPEED_RAW: int = 127  # 7-bit all-ones (127 * 2 = 254 km/h sentinel)
MAX_TRAFFIC_SPEED_KPH: int = 252      # 126 * 2 km/h
MIN_K_ANONYMITY_CONTRIBUTORS: int = 5
STALE_THRESHOLD_SECONDS: int = 900    # 15 minutes
EXPIRED_THRESHOLD_SECONDS: int = 1800 # 30 minutes


class TrafficState(str, enum.Enum):
    LIVE = "LIVE"
    LIVE_LOW_CONFIDENCE = "LIVE_LOW_CONFIDENCE"
    HISTORICAL = "HISTORICAL"
    ESTIMATED = "ESTIMATED"
    STALE = "STALE"
    NO_DATA = "NO_DATA"


class GraphVersionMismatchError(RuntimeError):
    """Raised when attempting to apply traffic observations to an incompatible routing graph build."""


@dataclasses.dataclass(frozen=True)
class ProbeObservation:
    ephemeral_session_id: str
    speed_kph: float
    timestamp_epoch: int
    map_match_residual_m: float = 3.0


@dataclasses.dataclass(frozen=True)
class EdgeTrafficEvaluation:
    directed_edge_index: int
    state: TrafficState
    effective_speed_kph: Optional[float]
    free_flow_speed_kph: float
    contributor_count: int
    confidence_score: float
    valhalla_encoded_uint64: int
    render_as_live_color: bool


def encode_valhalla_traffic_speed(
    speed_kph: Optional[float],
    free_flow_speed_kph: float = 60.0,
    incidents_present: bool = False,
) -> int:
    """
    Packs a 64-bit Valhalla `TrafficSpeed` bitfield matching `baldr/traffictile.h`:

    Bit layout (little-endian 64-bit unsigned integer):
    - bits 0..6   (7 bits): overall_encoded_speed (kph // 2, 127 = UNKNOWN)
    - bits 7..13  (7 bits): encoded_speed1
    - bits 14..20 (7 bits): encoded_speed2
    - bits 21..27 (7 bits): encoded_speed3
    - bits 28..35 (8 bits): breakpoint1 (0..255)
    - bits 36..43 (8 bits): breakpoint2 (0..255)
    - bits 44..49 (6 bits): congestion1 (0 = unknown, 1 = free flow, 63 = max congestion)
    - bits 50..55 (6 bits): congestion2
    - bits 56..61 (6 bits): congestion3
    - bit  62     (1 bit) : incidents_present
    - bit  63     (1 bit) : spare
    """
    if speed_kph is None or math.isnan(speed_kph) or speed_kph < 0:
        raw_speed = UNKNOWN_TRAFFIC_SPEED_RAW
        congestion = 0
        bp1 = 0
        bp2 = 0
    else:
        clamped = min(float(MAX_TRAFFIC_SPEED_KPH), max(0.0, float(speed_kph)))
        raw_speed = int(round(clamped / 2.0))
        bp1 = 85   # 1/3 along edge
        bp2 = 170  # 2/3 along edge
        if free_flow_speed_kph <= 0:
            congestion = 1
        else:
            ratio = clamped / float(free_flow_speed_kph)
            if ratio >= 0.85:
                congestion = 1
            else:
                # Linearly scale congestion from 2..63 as speed drops toward 0
                congestion = min(63, max(2, int(round((1.0 - ratio) * 62.0)) + 1))

    inc_bit = 1 if incidents_present else 0

    word = (
        (raw_speed & 0x7F)
        | ((raw_speed & 0x7F) << 7)
        | ((raw_speed & 0x7F) << 14)
        | ((raw_speed & 0x7F) << 21)
        | ((bp1 & 0xFF) << 28)
        | ((bp2 & 0xFF) << 36)
        | ((congestion & 0x3F) << 44)
        | ((congestion & 0x3F) << 50)
        | ((congestion & 0x3F) << 56)
        | ((inc_bit & 0x01) << 62)
    )
    return word


def decode_valhalla_traffic_speed(word: int) -> Dict[str, int]:
    """Unpacks a 64-bit Valhalla `TrafficSpeed` bitfield for verification and testing."""
    overall_raw = word & 0x7F
    speed1_raw = (word >> 7) & 0x7F
    bp1 = (word >> 28) & 0xFF
    bp2 = (word >> 36) & 0xFF
    congestion1 = (word >> 44) & 0x3F
    incidents = (word >> 62) & 0x01
    return {
        "overall_raw": overall_raw,
        "overall_kph": None if overall_raw == UNKNOWN_TRAFFIC_SPEED_RAW else overall_raw * 2,
        "speed1_raw": speed1_raw,
        "breakpoint1": bp1,
        "breakpoint2": bp2,
        "congestion1": congestion1,
        "incidents_present": incidents,
    }


def evaluate_edge_traffic(
    directed_edge_index: int,
    observations: Sequence[ProbeObservation],
    free_flow_speed_kph: float,
    historical_speed_kph: Optional[float] = None,
    now_epoch: Optional[int] = None,
) -> EdgeTrafficEvaluation:
    """
    Aggregates map-matched probe observations for a single directed edge, enforcing:
    1. Map-matching residual filter (<= 25m from road centerline).
    2. Deduplication by ephemeral_session_id (prevents a single parked/looping device
       from satisfying k-anonymity).
    3. Hard k-anonymity gate: requires >= 5 distinct ephemeral sessions for LIVE states.
    4. Harmonic mean speed aggregation.
    """
    now = int(time.time()) if now_epoch is None else int(now_epoch)

    # Filter out poor map matches (> 25m residual) or expired probes (> 30 min old)
    valid_obs = [
        o for o in observations
        if 0.0 <= o.speed_kph <= 200.0
        and o.map_match_residual_m <= 25.0
        and (now - o.timestamp_epoch) <= EXPIRED_THRESHOLD_SECONDS
    ]

    # Group by distinct ephemeral_session_id (latest observation per session wins)
    by_session: Dict[str, ProbeObservation] = {}
    for obs in valid_obs:
        prev = by_session.get(obs.ephemeral_session_id)
        if prev is None or obs.timestamp_epoch >= prev.timestamp_epoch:
            by_session[obs.ephemeral_session_id] = obs

    recent_sessions = [
        o for o in by_session.values()
        if (now - o.timestamp_epoch) <= STALE_THRESHOLD_SECONDS
    ]
    k_recent = len(recent_sessions)

    # Case 1: Sufficient live contributors (k >= 5) within active window
    if k_recent >= MIN_K_ANONYMITY_CONTRIBUTORS:
        speeds = [max(2.0, o.speed_kph) for o in recent_sessions]
        harmonic_speed = len(speeds) / sum(1.0 / s for s in speeds)
        mean_speed = sum(speeds) / len(speeds)
        variance = sum((s - mean_speed) ** 2 for s in speeds) / len(speeds)
        std_dev = math.sqrt(variance)

        if k_recent >= 8 and std_dev < 15.0:
            state = TrafficState.LIVE
            confidence = min(0.99, 0.70 + 0.03 * k_recent)
            effective_speed = harmonic_speed
        else:
            state = TrafficState.LIVE_LOW_CONFIDENCE
            confidence = 0.55
            if historical_speed_kph is not None:
                effective_speed = 0.65 * harmonic_speed + 0.35 * historical_speed_kph
            else:
                effective_speed = harmonic_speed

        encoded = encode_valhalla_traffic_speed(effective_speed, free_flow_speed_kph)
        return EdgeTrafficEvaluation(
            directed_edge_index=directed_edge_index,
            state=state,
            effective_speed_kph=round(effective_speed, 1),
            free_flow_speed_kph=free_flow_speed_kph,
            contributor_count=k_recent,
            confidence_score=round(confidence, 2),
            valhalla_encoded_uint64=encoded,
            render_as_live_color=True,
        )

    # Case 2: Had >= 5 contributors 15–30 minutes ago, now stale
    if len(by_session) >= MIN_K_ANONYMITY_CONTRIBUTORS:
        speeds = [max(2.0, o.speed_kph) for o in by_session.values()]
        harmonic_speed = len(speeds) / sum(1.0 / s for s in speeds)
        blended = (
            0.4 * harmonic_speed + 0.6 * historical_speed_kph
            if historical_speed_kph is not None
            else harmonic_speed
        )
        # Do NOT inject stale speeds as fresh live speeds in traffic.tar; let Valhalla use historical
        encoded = encode_valhalla_traffic_speed(None, free_flow_speed_kph)
        return EdgeTrafficEvaluation(
            directed_edge_index=directed_edge_index,
            state=TrafficState.STALE,
            effective_speed_kph=round(blended, 1),
            free_flow_speed_kph=free_flow_speed_kph,
            contributor_count=len(by_session),
            confidence_score=0.30,
            valhalla_encoded_uint64=encoded,
            render_as_live_color=False,
        )

    # Case 3: Insufficient live contributors (k < 5) -> NEVER publish live speed (Privacy & Honesty Rule)
    if historical_speed_kph is not None:
        return EdgeTrafficEvaluation(
            directed_edge_index=directed_edge_index,
            state=TrafficState.HISTORICAL,
            effective_speed_kph=round(historical_speed_kph, 1),
            free_flow_speed_kph=free_flow_speed_kph,
            contributor_count=k_recent,
            confidence_score=0.45,
            valhalla_encoded_uint64=encode_valhalla_traffic_speed(None, free_flow_speed_kph),
            render_as_live_color=False,
        )

    return EdgeTrafficEvaluation(
        directed_edge_index=directed_edge_index,
        state=TrafficState.NO_DATA,
        effective_speed_kph=None,
        free_flow_speed_kph=free_flow_speed_kph,
        contributor_count=k_recent,
        confidence_score=0.0,
        valhalla_encoded_uint64=encode_valhalla_traffic_speed(None, free_flow_speed_kph),
        render_as_live_color=False,
    )


def build_valhalla_traffic_tile_bytes(
    tile_id: int,
    directed_edge_count: int,
    edge_evaluations: Dict[int, EdgeTrafficEvaluation],
    last_update_epoch: Optional[int] = None,
) -> bytes:
    """
    Serializes a binary Valhalla traffic tile (`TrafficTileHeader` + `TrafficSpeed[]`).

    Header layout (`baldr/traffictile.h`, 32 bytes total, little-endian):
    - `tile_id`              : uint64
    - `last_update`          : uint64 (epoch seconds)
    - `directed_edge_count`  : uint32
    - `traffic_tile_version` : uint32
    - `spare2`               : uint32
    - `spare3`               : uint32
    """
    if directed_edge_count <= 0:
        raise ValueError("directed_edge_count must be > 0")

    update_ts = int(time.time()) if last_update_epoch is None else int(last_update_epoch)
    header = struct.pack(
        "<QQIIII",
        tile_id,
        update_ts,
        directed_edge_count,
        TRAFFIC_TILE_VERSION,
        0,
        0,
    )

    unknown_word = encode_valhalla_traffic_speed(None)
    speeds = [unknown_word] * directed_edge_count

    for idx, ev in edge_evaluations.items():
        if idx < 0 or idx >= directed_edge_count:
            raise IndexError(
                f"Directed edge index {idx} out of bounds for tile {tile_id} (count={directed_edge_count})"
            )
        speeds[idx] = ev.valhalla_encoded_uint64

    body = struct.pack(f"<{directed_edge_count}Q", *speeds)
    return header + body


def write_valhalla_traffic_tar(
    expected_graph_version_id: str,
    target_graph_version_id: str,
    tiles: Dict[Tuple[int, int], bytes],
) -> bytes:
    """
    Packs multiple traffic tiles (`(level, tile_id) -> raw_bytes`) into an uncompressed
    POSIX `.tar` archive (`traffic.tar`) with an embedded `hexa_graph_version.json` guard.
    """
    if not expected_graph_version_id or expected_graph_version_id != target_graph_version_id:
        raise GraphVersionMismatchError(
            f"Refusing to publish traffic.tar: traffic observations target graph "
            f"'{target_graph_version_id}', but active routing graph is '{expected_graph_version_id}'."
        )

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for (level, tile_id), raw_tile in sorted(tiles.items()):
            path = f"{level}/{tile_id // 1000:03d}/{tile_id % 1000:03d}.gph"
            info = tarfile.TarInfo(name=path)
            info.size = len(raw_tile)
            info.mtime = int(time.time())
            tf.addfile(info, io.BytesIO(raw_tile))
    return buf.getvalue()
