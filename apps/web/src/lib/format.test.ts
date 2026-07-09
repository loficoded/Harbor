import {
  formatAddress,
  formatHash,
  formatRelativeTime,
  formatUtcTimestamp,
  truncateMiddle,
} from "@/lib/format";
import { describe, expect, it } from "vitest";

describe("truncateMiddle", () => {
  it("leaves short values untouched", () => {
    expect(truncateMiddle("short", 6, 4)).toBe("short");
  });

  it("collapses long values to lead…tail form", () => {
    expect(truncateMiddle("0x1234567890abcdef", 6, 4)).toBe("0x1234…cdef");
  });
});

describe("formatAddress / formatHash", () => {
  it("formats an EVM address compactly", () => {
    expect(formatAddress("0x00000000000000000000000000000000000000a1")).toBe(
      "0x0000…00a1",
    );
  });

  it("formats a hash with a longer lead and tail", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(formatHash(hash)).toBe("0xabababab…abababab");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;

  it("reports sub-5s and future instants as just now", () => {
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now - 2_000, now)).toBe("just now");
    // Clock skew: a slightly-future timestamp is clamped, not negative.
    expect(formatRelativeTime(now + 10_000, now)).toBe("just now");
  });

  it("reports seconds, minutes, hours, and days", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("formatUtcTimestamp", () => {
  it("formats an ISO instant as a stable UTC string", () => {
    expect(formatUtcTimestamp("2026-01-02T03:04:05.678Z")).toBe(
      "2026-01-02 03:04:05 UTC",
    );
  });

  it("returns the raw value for an unparseable input", () => {
    expect(formatUtcTimestamp("not-a-date")).toBe("not-a-date");
  });
});
