import { describe, expect, it } from "vitest";
import {
  MAX_DEADLINE_SECONDS,
  ProtocolInputError,
  parseAsset,
  parseDeadline,
  parseNetwork,
  parseProtocolAmount,
  parseProtocolInput,
} from "./protocolInput.js";

const walletAddress = "G" + "A".repeat(55);

describe("protocol amount parsing", () => {
  it.each([
    ["1", 10_000_000n],
    ["0.0000001", 1n],
    ["123.4500000", 1_234_500_000n],
  ])("parses %s without floating-point rounding", (raw, units) => {
    expect(parseProtocolAmount(raw)).toMatchObject({ raw, units });
  });

  it.each(["", "0", "00.1", "-1", "1e3", "1.12345678", "1.2.3"])(
    "rejects malformed amount %s",
    (raw) => {
      expect(() => parseProtocolAmount(raw)).toThrowError(
        expect.objectContaining({
          code: "INVALID_AMOUNT",
          field: "amount",
        } satisfies Partial<ProtocolInputError>),
      );
    },
  );

  it("rejects an amount above the protocol bound", () => {
    expect(() => parseProtocolAmount("1000000000000000000000000000000")).toThrowError(
      expect.objectContaining({ code: "AMOUNT_OUT_OF_RANGE" }),
    );
  });
});

describe("protocol allowlists and deadlines", () => {
  it("accepts supported assets and networks only", () => {
    expect(parseAsset("XLM")).toBe("XLM");
    expect(parseAsset("USDC")).toBe("USDC");
    expect(parseNetwork("testnet")).toBe("testnet");
    expect(parseNetwork("mainnet")).toBe("mainnet");
  });

  it("rejects unsupported assets and networks with field codes", () => {
    expect(() => parseAsset("BTC")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_ASSET", field: "asset" }),
    );
    expect(() => parseNetwork("devnet")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_NETWORK", field: "network" }),
    );
  });

  it("accepts a boundary deadline but rejects past and overlong windows", () => {
    expect(parseDeadline(1_000 + MAX_DEADLINE_SECONDS, 1_000)).toBe(1_000 + MAX_DEADLINE_SECONDS);
    expect(() => parseDeadline(999, 1_000)).toThrowError(
      expect.objectContaining({ code: "INVALID_DEADLINE" }),
    );
    expect(() => parseDeadline(1_001 + MAX_DEADLINE_SECONDS, 1_000)).toThrowError(
      expect.objectContaining({ code: "INVALID_DEADLINE" }),
    );
  });
});

describe("complete protocol validation boundary", () => {
  it("returns canonical defaults and parsed precision-safe values", () => {
    expect(parseProtocolInput({ walletAddress, amount: "2.5" }, 1_000)).toEqual({
      walletAddress,
      amount: { raw: "2.5", units: 25_000_000n, decimals: 1 },
      asset: "XLM",
      network: "testnet",
      deadline: 1_060,
    });
  });

  it("requires a valid Stellar public address before protocol work", () => {
    expect(() =>
      parseProtocolInput({ walletAddress: "not-an-address", amount: "1" }, 1_000),
    ).toThrowError(expect.objectContaining({ field: "walletAddress" }));
  });

  it("rejects an oversized body field without exposing internals", () => {
    expect(() =>
      parseProtocolInput({ walletAddress, amount: "1", asset: "X".repeat(1_000) }, 1_000),
    ).toThrowError(expect.objectContaining({ field: "asset", code: "UNSUPPORTED_ASSET" }));
  });

  it("accepts explicit string deadlines without numeric coercion surprises", () => {
    expect(
      parseProtocolInput({ walletAddress, amount: "1", deadline: "1060" }, 1_000).deadline,
    ).toBe(1_060);
    expect(() =>
      parseProtocolInput({ walletAddress, amount: "1", deadline: "1.5" }, 1_000),
    ).toThrowError(expect.objectContaining({ field: "deadline" }));
  });

  it("keeps generated decimal amounts precise across a boundary corpus", () => {
    for (let digit = 1; digit <= 7; digit += 1) {
      const fraction = `0.${"0".repeat(digit - 1)}1`;
      const raw = `12${fraction.slice(1)}`;
      const parsed = parseProtocolAmount(raw);
      expect(parsed.units % 10n ** BigInt(7 - digit)).toBe(0n);
      expect(parsed.raw).toBe(raw);
    }
  });

  it.each([
    { walletAddress: "", amount: "1" },
    { walletAddress: "G" + "A".repeat(54), amount: "1" },
    { walletAddress: "G" + "A".repeat(56), amount: "1" },
    { walletAddress, amount: undefined },
    { walletAddress, amount: null },
    { walletAddress, amount: 1 },
  ])("rejects malformed request shape %# before parsing protocol fields", (body) => {
    expect(() => parseProtocolInput(body, 1_000)).toThrowError(ProtocolInputError);
  });

  it("does not accept JavaScript numeric amounts even when integral", () => {
    expect(() => parseProtocolInput({ walletAddress, amount: 100 }, 1_000)).toThrowError(
      expect.objectContaining({ field: "amount", code: "INVALID_AMOUNT" }),
    );
  });

  it("rejects unsafe deadline integers and numeric exponent strings", () => {
    expect(() => parseDeadline(Number.MAX_SAFE_INTEGER + 1, 1_000)).toThrowError(
      expect.objectContaining({ field: "deadline" }),
    );
    expect(() =>
      parseProtocolInput({ walletAddress, amount: "1", deadline: "1e3" }, 1_000),
    ).toThrowError(expect.objectContaining({ field: "deadline" }));
  });

  it("does not coerce lowercase or whitespace-padded asset/network values", () => {
    expect(() =>
      parseProtocolInput({ walletAddress, amount: "1", asset: "xlm" }, 1_000),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_ASSET" }));
    expect(() =>
      parseProtocolInput({ walletAddress, amount: "1", network: " testnet" }, 1_000),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_NETWORK" }));
  });

  it("preserves the canonical representation for explicit protocol options", () => {
    expect(
      parseProtocolInput(
        {
          walletAddress,
          amount: "1.0000000",
          asset: "USDC",
          network: "mainnet",
          deadline: "1060",
        },
        1_000,
      ),
    ).toEqual({
      walletAddress,
      amount: { raw: "1.0000000", units: 10_000_000n, decimals: 7 },
      asset: "USDC",
      network: "mainnet",
      deadline: 1_060,
    });
  });

  it.each([
    ["0.0000001", 1n],
    ["1.0000000", 10_000_000n],
    ["999999999.1234567", 9_999_999_991_234_567n],
  ])("converts %s to exact integer protocol units", (raw, units) => {
    expect(parseProtocolAmount(raw).units).toBe(units);
  });

  it.each([
    ["+1", "INVALID_AMOUNT"],
    ["01.0", "INVALID_AMOUNT"],
    ["1.", "INVALID_AMOUNT"],
    [".1", "INVALID_AMOUNT"],
    ["1.00000001", "INVALID_AMOUNT"],
    ["NaN", "INVALID_AMOUNT"],
  ])("rejects non-canonical amount %s", (raw, code) => {
    expect(() => parseProtocolAmount(raw)).toThrowError(expect.objectContaining({ code }));
  });
});
