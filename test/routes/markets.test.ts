import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { AssetRegistryService } from "../../src/services/markets/assetRegistryService.js";
import { ReserveDataService } from "../../src/services/markets/reserveDataService.js";

const app = createApp();

describe("GET /api/v1/markets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return joined market listing (happy path)", async () => {
    const mockAssets = [
      {
        id: "xlm",
        symbol: "XLM",
        name: "Stellar Lumens",
        decimals: 7,
        iconUrl: "https://stellarlend.app/icons/xlm.svg",
      },
    ];

    const mockReserveData = {
      assetId: "xlm",
      totalSupply: "1000",
      totalBorrow: "500",
      supplyApy: 0.05,
      borrowApy: 0.08,
      utilization: 0.5,
    };

    vi.spyOn(AssetRegistryService.prototype, "getSupportedAssets").mockResolvedValue(mockAssets);
    vi.spyOn(ReserveDataService.prototype, "getReserveData").mockResolvedValue(mockReserveData);

    const response = await request(app).get("/api/v1/markets");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      ...mockAssets[0],
      reserveData: mockReserveData,
    });
    expect(response.headers).toHaveProperty("etag");
  });

  it("should return degraded listing with dataUnavailable flag when reserve data fails", async () => {
    const mockAssets = [
      {
        id: "usdc",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 7,
        iconUrl: "https://stellarlend.app/icons/usdc.svg",
      },
    ];

    vi.spyOn(AssetRegistryService.prototype, "getSupportedAssets").mockResolvedValue(mockAssets);
    vi.spyOn(ReserveDataService.prototype, "getReserveData").mockRejectedValue(
      new Error("Soroban RPC timeout"),
    );

    const response = await request(app).get("/api/v1/markets");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      ...mockAssets[0],
      dataUnavailable: true,
    });
    expect(response.body[0]).not.toHaveProperty("reserveData");
  });

  it("should return 304 Not Modified when ETag matches", async () => {
    const mockAssets = [
      {
        id: "eurc",
        symbol: "EURC",
        name: "Euro Coin",
        decimals: 7,
        iconUrl: "https://stellarlend.app/icons/eurc.svg",
      },
    ];

    vi.spyOn(AssetRegistryService.prototype, "getSupportedAssets").mockResolvedValue(mockAssets);
    vi.spyOn(ReserveDataService.prototype, "getReserveData").mockResolvedValue({
      assetId: "eurc",
      totalSupply: "0",
      totalBorrow: "0",
      supplyApy: 0,
      borrowApy: 0,
      utilization: 0,
    });

    // First request to get the ETag
    const firstResponse = await request(app).get("/api/v1/markets");
    expect(firstResponse.status).toBe(200);
    const etag = firstResponse.headers.etag;
    expect(etag).toBeDefined();

    // Second request with If-None-Match header
    const secondResponse = await request(app).get("/api/v1/markets").set("If-None-Match", etag!);

    expect(secondResponse.status).toBe(304);
    expect(secondResponse.body).toEqual({});
  });
});
