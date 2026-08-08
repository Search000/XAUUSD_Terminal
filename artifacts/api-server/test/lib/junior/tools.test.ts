import { describe, it, expect, vi, beforeEach } from "vitest";

const getXauusdPrice = vi.fn();
const getXauusdCandles = vi.fn();

vi.mock("../../../src/lib/marketData", () => ({
  getXauusdPrice: (...args: unknown[]) => getXauusdPrice(...args),
  getXauusdCandles: (...args: unknown[]) => getXauusdCandles(...args),
}));

import { get_xauusd_price, get_market_data, juniorTools } from "../../../src/lib/junior/tools";

describe("junior tools registry", () => {
  it("exposes exactly the market-data tools built so far, by name", () => {
    expect(Object.keys(juniorTools).sort()).toEqual(["get_market_data", "get_xauusd_price"]);
  });
});

describe("get_xauusd_price tool", () => {
  beforeEach(() => {
    getXauusdPrice.mockReset();
    getXauusdCandles.mockReset();
  });

  it("returns the real price data from the shared market-data function", async () => {
    const fakePrice = { price: 2400.5, change: 1.2, changePct: 0.05, marketOpen: true };
    getXauusdPrice.mockResolvedValue(fakePrice);

    const result = await get_xauusd_price.run(undefined, {});

    expect(getXauusdPrice).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: fakePrice });
  });

  it("never fabricates data — returns a typed failure when the upstream call fails", async () => {
    getXauusdPrice.mockRejectedValue(new Error("Price feed rate-limited (429)"));

    const result = await get_xauusd_price.run(undefined, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("get_xauusd_price is currently unavailable");
    }
  });

  it("does not require auth (public market data)", () => {
    expect(get_xauusd_price.requiresAuth).toBe(false);
  });
});

describe("get_market_data tool", () => {
  beforeEach(() => {
    getXauusdPrice.mockReset();
    getXauusdCandles.mockReset();
  });

  it("defaults to the 1h interval when none is given", async () => {
    getXauusdCandles.mockResolvedValue({ candles: [], interval: "1h", count: 0 });

    await get_market_data.run({}, {});

    expect(getXauusdCandles).toHaveBeenCalledWith("1h");
  });

  it("passes through an explicit interval", async () => {
    getXauusdCandles.mockResolvedValue({ candles: [], interval: "4h", count: 0 });

    await get_market_data.run({ interval: "4h" }, {});

    expect(getXauusdCandles).toHaveBeenCalledWith("4h");
  });

  it("surfaces upstream failure as a typed error, not fabricated candles", async () => {
    getXauusdCandles.mockRejectedValue(new Error("Not enough data"));

    const result = await get_market_data.run({ interval: "1m" }, {});

    expect(result.ok).toBe(false);
  });
});
