export type SlackVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_headers"
        | "malformed"
        | "timestamp_skew"
        | "bad_signature";
    };

export type VerifyResult = SlackVerifyResult;

const SLACK_VERSION = "v0";
const SIGNATURE_PREFIX = "v0=";
const MAX_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const HMAC_ALGORITHM = { name: "HMAC", hash: "SHA-256" };

/**
 * Verifies a Slack request signature against the exact raw request body bytes.
 *
 * Contract: callers must pass the raw body exactly as received, before parsing
 * or re-serializing. If the caller gets the body from a Request, that read
 * consumes the body stream; clone the Request first when downstream code still
 * needs to read it.
 */
export async function verifySlackSignature(
  rawBody: string,
  headers: Headers,
  signingSecret: string,
  now: () => number = () => Date.now(),
): Promise<SlackVerifyResult> {
  if (signingSecret.length === 0) {
    throw new Error("Slack signing secret is required");
  }

  try {
    const timestampHeader = headers.get("X-Slack-Request-Timestamp");
    const signatureHeader = headers.get("X-Slack-Signature");
    if (!timestampHeader || !signatureHeader) {
      return { ok: false, reason: "missing_headers" };
    }

    const timestamp = parseTimestampSeconds(timestampHeader);
    if (timestamp === null) {
      return { ok: false, reason: "malformed" };
    }

    if (!isSignatureHeaderWellFormed(signatureHeader, SIGNATURE_PREFIX)) {
      return { ok: false, reason: "malformed" };
    }

    if (Math.abs(now() - timestamp * 1000) > MAX_REPLAY_WINDOW_MS) {
      return { ok: false, reason: "timestamp_skew" };
    }

    const baseString = `${SLACK_VERSION}:${timestampHeader}:${rawBody}`;
    const expectedDigest = await hmacSha256(signingSecret, encodeUtf8(baseString));
    const expectedSignature = `${SIGNATURE_PREFIX}${bytesToHex(expectedDigest)}`;

    return constantTimeEqual(encodeView(signatureHeader), encodeView(expectedSignature))
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function parseTimestampSeconds(value: string): number | null {
  let timestamp = 0;
  if (value.length === 0) {
    return null;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return null;
    }
    timestamp = timestamp * 10 + (code - 48);
  }

  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

async function hmacSha256(
  secret: string,
  data: BufferSource,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    HMAC_ALGORITHM,
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(HMAC_ALGORITHM.name, key, data);
  return new Uint8Array(signature);
}

function isSignatureHeaderWellFormed(value: string, prefix: string): boolean {
  const encodedValue = encodeView(value);
  const encodedPrefix = encodeView(prefix);
  const digest = encodedValue.subarray(encodedPrefix.byteLength);

  return (
    constantTimeEqual(
      encodedValue.subarray(0, encodedPrefix.byteLength),
      encodedPrefix,
    ) && isNonEmptyHex(digest)
  );
}

function isNonEmptyHex(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) {
    return false;
  }

  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (hexNibble(bytes[index]) < 0) {
      return false;
    }
  }

  return true;
}

function hexNibble(code: number | undefined): number {
  if (code === undefined) {
    return -1;
  }
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  return -1;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index] ?? 0;
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function encodeUtf8(value: string): ArrayBuffer {
  return copyToArrayBuffer(encodeView(value));
}

function encodeView(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}
