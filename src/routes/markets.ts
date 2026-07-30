import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AssetRegistryService } from "../services/markets/assetRegistryService.js";
import { ReserveDataService } from "../services/markets/reserveDataService.js";
import { MarketsListingService } from "../services/markets/marketsListingService.js";

export const marketsRouter = Router();

const registryService = new AssetRegistryService();
const reserveDataService = new ReserveDataService();
const marketsListingService = new MarketsListingService(registryService, reserveDataService);

marketsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const listings = await marketsListingService.getMarketsListing();

    // Generate ETag based on the response payload
    const responsePayload = JSON.stringify(listings);
    const etag = `"${crypto.createHash("md5").update(responsePayload).digest("hex")}"`;

    // Check conditional GET
    if (req.headers["if-none-match"] === etag) {
      // The client already has the latest version
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=5"); // Cache for a short time
    res.status(200).json(listings);
  } catch (error) {
    // Top-level error boundary
    res.status(500).json({ error: "Internal server error fetching markets listing" });
  }
});
