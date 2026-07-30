export interface AssetMetadata {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string;
}

/**
 * Provides static per-asset metadata.
 * In a real implementation, this might read from a local JSON registry or DB.
 */
export class AssetRegistryService {
  private static readonly REGISTRY: AssetMetadata[] = [
    {
      id: "xlm",
      symbol: "XLM",
      name: "Stellar Lumens",
      decimals: 7,
      iconUrl: "https://stellarlend.app/icons/xlm.svg",
    },
    {
      id: "usdc",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 7,
      iconUrl: "https://stellarlend.app/icons/usdc.svg",
    },
    {
      id: "eurc",
      symbol: "EURC",
      name: "Euro Coin",
      decimals: 7,
      iconUrl: "https://stellarlend.app/icons/eurc.svg",
    },
  ];

  /**
   * Fetch all supported assets from the registry.
   */
  public async getSupportedAssets(): Promise<AssetMetadata[]> {
    // Simulating async retrieval
    return AssetRegistryService.REGISTRY;
  }
}
