import { describe, expect, it } from "vitest";
import { redisAdapterUrl, scalingNotice, shouldAttachRedisAdapter } from "./realtime-scaling";

describe("redisAdapterUrl", () => {
  it("accepts redis and rediss URLs", () => {
    expect(redisAdapterUrl("redis://localhost:6379")).toBe("redis://localhost:6379");
    expect(redisAdapterUrl("rediss://user:pass@host:6380/0")).toBe(
      "rediss://user:pass@host:6380/0",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(redisAdapterUrl("  redis://localhost:6379  ")).toBe("redis://localhost:6379");
  });

  it("rejects an unset or empty value", () => {
    expect(redisAdapterUrl(undefined)).toBeNull();
    expect(redisAdapterUrl("")).toBeNull();
    expect(redisAdapterUrl("   ")).toBeNull();
  });

  it("rejects a non-redis scheme pasted into the wrong variable", () => {
    expect(redisAdapterUrl("postgresql://user@localhost:5432/busguard")).toBeNull();
    expect(redisAdapterUrl("https://example.com")).toBeNull();
  });

  it("rejects a value that is not a URL", () => {
    expect(redisAdapterUrl("localhost:6379")).toBeNull();
  });
});

describe("shouldAttachRedisAdapter", () => {
  it("is off by default", () => {
    expect(shouldAttachRedisAdapter(undefined)).toBe(false);
  });

  it("is on when a valid URL is present", () => {
    expect(shouldAttachRedisAdapter("redis://localhost:6379")).toBe(true);
  });
});

describe("scalingNotice", () => {
  it("names the mode either way", () => {
    expect(scalingNotice(undefined)).toContain("single-instance");
    expect(scalingNotice("redis://localhost:6379")).toContain("Redis adapter configured");
  });
});
