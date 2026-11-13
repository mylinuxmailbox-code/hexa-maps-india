/**
 * HEXA MAPS — Privacy-First Live Location Sharing (`services/api/src/modules/location-sharing`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 12 & `docs/SECURITY_THREAT_MODEL.md` Section 2.2:
 * - Strictly time-bounded sessions (15m, 1h, 8h, max 24h — NEVER infinite by default).
 * - End-to-End Encrypted (E2EE) Payload Relay: The client encrypts `{ latitude, longitude, speedKph, batteryLevel }`
 *   using AES-256-GCM with an ephemeral secret key placed only in the URL `#fragment` (never sent to the server).
 *   The server stores and relays only opaque `{ ivHex, ciphertextHex, authTagHex }` blobs.
 * - Instant one-call revocation (`revokeSession`) that deletes the server relay state immediately.
 */

import crypto from 'node:crypto';

const MAX_SHARE_DURATION_SECONDS = 86_400; // 24 hours hard ceiling

export class LocationSharingService {
  constructor() {
    /** @type {Map<string, Object>} */
    this.sessions = new Map();
  }

  /**
   * Creates a time-bounded capability session.
   */
  createShareSession({
    durationSeconds = 3600,
    nowEpoch = Math.floor(Date.now() / 1000)
  } = {}) {
    if (durationSeconds <= 0 || durationSeconds > MAX_SHARE_DURATION_SECONDS) {
      throw new Error(`Share duration must be between 1 and ${MAX_SHARE_DURATION_SECONDS} seconds (no permanent sharing)`);
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    const writeToken = crypto.randomBytes(24).toString('hex');
    const expiresAtEpoch = nowEpoch + durationSeconds;

    this.sessions.set(sessionId, {
      sessionId,
      writeToken,
      createdAtEpoch: nowEpoch,
      expiresAtEpoch,
      latestEncryptedPayload: null,
      revoked: false
    });

    return {
      sessionId,
      writeToken,
      expiresAtEpoch
    };
  }

  /**
   * Publishes an E2EE encrypted coordinate frame. Rejects unencrypted raw coordinates!
   */
  publishEncryptedLocationUpdate({
    sessionId,
    writeToken,
    encryptedPayload,
    nowEpoch = Math.floor(Date.now() / 1000)
  }) {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked) {
      throw new Error('Share session does not exist or has been revoked');
    }
    if (nowEpoch >= session.expiresAtEpoch) {
      this.sessions.delete(sessionId);
      throw new Error('Share session has expired');
    }
    if (session.writeToken !== writeToken) {
      throw new Error('Invalid write token for location sharing session');
    }

    // Security invariant: server refuses plaintext coordinates on the relay endpoint
    if (
      !encryptedPayload ||
      typeof encryptedPayload.ciphertextHex !== 'string' ||
      typeof encryptedPayload.ivHex !== 'string' ||
      typeof encryptedPayload.authTagHex !== 'string' ||
      'latitude' in encryptedPayload ||
      'longitude' in encryptedPayload
    ) {
      throw new Error('Plaintext coordinates are forbidden; location sharing requires E2EE ciphertext');
    }

    session.latestEncryptedPayload = {
      ivHex: encryptedPayload.ivHex,
      ciphertextHex: encryptedPayload.ciphertextHex,
      authTagHex: encryptedPayload.authTagHex,
      updatedAtEpoch: nowEpoch
    };

    return { ok: true, expiresAtEpoch: session.expiresAtEpoch };
  }

  readEncryptedLocationUpdate(sessionId, nowEpoch = Math.floor(Date.now() / 1000)) {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked || nowEpoch >= session.expiresAtEpoch) {
      return null;
    }
    return {
      sessionId: session.sessionId,
      expiresAtEpoch: session.expiresAtEpoch,
      encryptedPayload: session.latestEncryptedPayload
    };
  }

  /**
   * Instant revocation: deletes the session and purges all buffered ciphertext.
   */
  revokeSession(sessionId, writeToken) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.writeToken !== writeToken) {
      throw new Error('Invalid write token for revocation');
    }
    session.revoked = true;
    session.latestEncryptedPayload = null;
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Client-side helper (for tests & SDKs) demonstrating AES-256-GCM E2EE encryption/decryption.
   */
  static encryptCoordinateClientSide(coordinatePayload, secretKey32Bytes) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secretKey32Bytes, iv);
    const plaintext = Buffer.from(JSON.stringify(coordinatePayload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ivHex: iv.toString('hex'),
      ciphertextHex: encrypted.toString('hex'),
      authTagHex: authTag.toString('hex')
    };
  }

  static decryptCoordinateClientSide(encryptedPayload, secretKey32Bytes) {
    const iv = Buffer.from(encryptedPayload.ivHex, 'hex');
    const ciphertext = Buffer.from(encryptedPayload.ciphertextHex, 'hex');
    const authTag = Buffer.from(encryptedPayload.authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey32Bytes, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }
}
