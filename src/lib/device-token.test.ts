import { describe, expect, it } from "vitest";
import {
  DEVICE_TOKEN_PREFIX,
  bearerToken,
  generateDeviceToken,
  hashDeviceToken,
  looksLikeDeviceToken,
} from "./device-token";

describe("generateDeviceToken", () => {
  it("mints a prefixed token and its hash", () => {
    const { token, hash } = generateDeviceToken();
    expect(token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashDeviceToken(token));
  });

  it("mints a different token every time", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it("is long enough to clear the shape check", () => {
    expect(looksLikeDeviceToken(generateDeviceToken().token)).toBe(true);
  });
});

describe("hashDeviceToken", () => {
  it("is deterministic", () => {
    expect(hashDeviceToken("nvd_abc")).toBe(hashDeviceToken("nvd_abc"));
  });

  it("does not return the input", () => {
    expect(hashDeviceToken("nvd_abc")).not.toContain("abc");
  });
});

describe("looksLikeDeviceToken", () => {
  it("rejects a token without the prefix", () => {
    expect(looksLikeDeviceToken("somethingelse")).toBe(false);
  });

  it("rejects a prefix with no body", () => {
    expect(looksLikeDeviceToken(DEVICE_TOKEN_PREFIX)).toBe(false);
    expect(looksLikeDeviceToken(`${DEVICE_TOKEN_PREFIX}short`)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("reads a bearer header", () => {
    expect(bearerToken("Bearer nvd_abc")).toBe("nvd_abc");
  });

  it("is case-insensitive about the scheme", () => {
    expect(bearerToken("bearer nvd_abc")).toBe("nvd_abc");
    expect(bearerToken("BEARER   nvd_abc")).toBe("nvd_abc");
  });

  it("rejects other schemes and junk", () => {
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
