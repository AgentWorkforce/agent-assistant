import { describe, expect, it, vi } from "vitest";

import { verifySlackSignature } from "./slack.js";

const SIGNING_SECRET = "slack-test-secret";
const NOW = 1_700_000_000_000;
const TIMESTAMP = String(Math.floor(NOW / 1000));

describe("verifySlackSignature", () => {
  it("accepts a valid Slack signature", async () => {
    const rawBody = JSON.stringify({ type: "event_callback", event_id: "Ev1" });
    const headers = await signedHeaders(rawBody, TIMESTAMP);

    await expect(
      verifySlackSignature(rawBody, headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects an equal-length bad signature without malformed short-circuit", async () => {
    const rawBody = "payload=hello";
    const headers = await signedHeaders(rawBody, TIMESTAMP);
    const original = headers.get("X-Slack-Signature");
    expect(original).toBeTruthy();
    headers.set("X-Slack-Signature", tamperLastHexDigit(original!));

    const signSpy = vi.spyOn(crypto.subtle, "sign");

    await expect(
      verifySlackSignature(rawBody, headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
    expect(signSpy).toHaveBeenCalled();

    signSpy.mockRestore();
  });

  it("rejects an old timestamp", async () => {
    const rawBody = "old=true";
    const oldTimestamp = String(Math.floor((NOW - 301_000) / 1000));
    const headers = await signedHeaders(rawBody, oldTimestamp);

    await expect(
      verifySlackSignature(rawBody, headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "timestamp_skew" });
  });

  it("rejects a timestamp too far in the future", async () => {
    const rawBody = "future=true";
    const futureTimestamp = String(Math.floor((NOW + 301_000) / 1000));
    const headers = await signedHeaders(rawBody, futureTimestamp);

    await expect(
      verifySlackSignature(rawBody, headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "timestamp_skew" });
  });

  it("rejects a tampered body", async () => {
    const rawBody = "payload=original";
    const headers = await signedHeaders(rawBody, TIMESTAMP);

    await expect(
      verifySlackSignature("payload=tampered", headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects missing headers", async () => {
    await expect(
      verifySlackSignature("payload=missing", new Headers(), SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects malformed signature headers", async () => {
    const headers = new Headers({
      "X-Slack-Request-Timestamp": TIMESTAMP,
      "X-Slack-Signature": "v0=not-hex",
    });

    await expect(
      verifySlackSignature("payload=bad", headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects length-mismatched hex signatures after computing the expected HMAC", async () => {
    const rawBody = "payload=short";
    const headers = await signedHeaders(rawBody, TIMESTAMP);
    const original = headers.get("X-Slack-Signature");
    expect(original).toBeTruthy();
    headers.set("X-Slack-Signature", original!.slice(0, -2));

    const signSpy = vi.spyOn(crypto.subtle, "sign");

    await expect(
      verifySlackSignature(rawBody, headers, SIGNING_SECRET, () => NOW),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
    expect(signSpy).toHaveBeenCalled();

    signSpy.mockRestore();
  });

  it("throws when called with an empty signing secret", async () => {
    const headers = await signedHeaders("payload=config", TIMESTAMP);

    await expect(
      verifySlackSignature("payload=config", headers, "", () => NOW),
    ).rejects.toThrow("Slack signing secret is required");
  });
});

async function signedHeaders(rawBody: string, timestamp: string): Promise<Headers> {
  const baseString = `v0:${timestamp}:${rawBody}`;
  const digest = await hmacSha256(SIGNING_SECRET, baseString);
  return new Headers({
    "X-Slack-Request-Timestamp": timestamp,
    "X-Slack-Signature": `v0=${bytesToHex(digest)}`,
  });
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encodeUtf8(data));
  return new Uint8Array(signature);
}

function encodeUtf8(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function tamperLastHexDigit(value: string): string {
  const replacement = value.endsWith("0") ? "1" : "0";
  return `${value.slice(0, -1)}${replacement}`;
}
