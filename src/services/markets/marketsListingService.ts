import { AssetRegistryService, AssetMetadata } from "./assetRegistryService.js";
import { ReserveDataService, ReserveData } from "./reserveDataService.js";
import { logger } from "../../lib/logger.js";

export interface MarketListing extends AssetMetadata {
  reserveData?: ReserveData;
  dataUnavailable?: boolean;
}

/**
 * Service to orchestrate the joining of static asset metadata
 * with live reserve data from Soroban.
 */
export class MarketsListingService {
  constructor(
    private readonly registryService: AssetRegistryService,
    private readonly reserveDataService: ReserveDataService,
  ) {}

  /**
   * Fetches all markets by combining registry metadata and live reserve data.
   */
  public async getMarketsListing(): Promise<MarketListing[]> {
    const assets = await this.registryService.getSupportedAssets();

    const listingsPromises = assets.map(async (asset) => {
      try {
        const reserveData = await this.reserveDataService.getReserveData(asset.id);
        return {
          ...asset,
          reserveData,
        };
      } catch (error) {
        logger.warn(`Failed to fetch reserve data for asset ${asset.id}`, { error });
        return {
          ...asset,
          dataUnavailable: true,
        };
      }
    });

    return Promise.all(listingsPromises);
  }
}
