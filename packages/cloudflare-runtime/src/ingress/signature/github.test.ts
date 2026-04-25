import { describe, expect, it, vi } from "vitest";

import { verifyGitHubSignature } from "./github.js";

const WEBHOOK_SECRET = "github-test-secret";

describe("verifyGitHubSignature", () => {
  it("accepts a valid GitHub signature", async () => {
    const rawBody = JSON.stringify({ action: "opened", issue: { number: 1 } });
    const headers = await signedHeaders(rawBody);

    await expect(
      verifyGitHubSignature(rawBody, headers, WEBHOOK_SECRET),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects an equal-length bad signature without malformed short-circuit", async () => {
    const rawBody = "github=payload";
    const headers = await signedHeaders(rawBody);
    const original = headers.get("X-Hub-Signature-256");
    expect(original).toBeTruthy();
    headers.set("X-Hub-Signature-256", tamperLastHexDigit(original!));

    const signSpy = vi.spyOn(crypto.subtle, "sign");

    await expect(
      verifyGitHubSignature(rawBody, headers, WEBHOOK_SECRET),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
    expect(signSpy).toHaveBeenCalled();

    signSpy.mockRestore();
  });

  it("rejects a tampered body", async () => {
    const rawBody = "github=original";
    const headers = await signedHeaders(rawBody);

    await expect(
      verifyGitHubSignature("github=tampered", headers, WEBHOOK_SECRET),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects missing headers", async () => {
    await expect(
      verifyGitHubSignature("github=missing", new Headers(), WEBHOOK_SECRET),
    ).resolves.toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects malformed signature headers", async () => {
    const headers = new Headers({
      "X-Hub-Signature-256": "sha256=not-hex",
    });

    await expect(
      verifyGitHubSignature("github=bad", headers, WEBHOOK_SECRET),
    ).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects length-mismatched hex signatures after computing the expected HMAC", async () => {
    const rawBody = "github=short";
    const headers = await signedHeaders(rawBody);
    const original = headers.get("X-Hub-Signature-256");
    expect(original).toBeTruthy();
    headers.set("X-Hub-Signature-256", original!.slice(0, -2));

    const signSpy = vi.spyOn(crypto.subtle, "sign");

    await expect(
      verifyGitHubSignature(rawBody, headers, WEBHOOK_SECRET),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
    expect(signSpy).toHaveBeenCalled();

    signSpy.mockRestore();
  });

  it("throws when called with an empty webhook secret", async () => {
    const headers = await signedHeaders("github=config");

    await expect(
      verifyGitHubSignature("github=config", headers, ""),
    ).rejects.toThrow("GitHub webhook secret is required");
  });
});

async function signedHeaders(rawBody: string): Promise<Headers> {
  const digest = await hmacSha256(WEBHOOK_SECRET, rawBody);
  return new Headers({
    "X-Hub-Signature-256": `sha256=${bytesToHex(digest)}`,
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
