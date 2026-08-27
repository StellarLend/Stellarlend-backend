import { recordDependency } from "../../lib/observability.js";

export interface ReserveData {
  assetId: string;
  totalSupply: string;
  totalBorrow: string;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
}

/**
 * Service to fetch live reserve data from the Soroban lending pool.
 */
export class ReserveDataService {
  /**
   * Fetch live reserve data for a specific asset.
   * In a real implementation, this would query a Soroban RPC node or a Redis cache.
   */
  public async getReserveData(assetId: string): Promise<ReserveData> {
    const startedAt = Date.now();
    // Simulating external network call that could fail
    if (Math.random() < 0.05) {
      recordDependency("soroban", "error", Date.now() - startedAt);
      throw new Error("Simulated network timeout connecting to Soroban RPC");
    }

    // Return mock data for the requested asset
    const result = {
      assetId,
      totalSupply: "10000000000",
      totalBorrow: "5000000000",
      supplyApy: 0.05,
      borrowApy: 0.08,
      utilization: 0.5,
    };
    recordDependency("soroban", "success", Date.now() - startedAt);
    return result;
  }
}
