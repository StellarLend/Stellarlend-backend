import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AssetRegistryService } from "../services/markets/assetRegistryService.js";
import { ReserveDataService } from "../services/markets/reserveDataService.js";
import { MarketsListingService } from "../services/markets/marketsListingService.js";
import { InvalidCursorError, paginateCursor, cursorSecret } from "../services/cursorPagination.js";

export const marketsRouter = Router();

const registryService = new AssetRegistryService();
const reserveDataService = new ReserveDataService();
const marketsListingService = new MarketsListingService(registryService, reserveDataService);

marketsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const listings = await marketsListingService.getMarketsListing();
    const asset = typeof req.query.asset === "string" ? req.query.asset : undefined;
    const filtered = asset ? listings.filter((listing) => listing.id === asset || listing.symbol === asset) : listings;
    const page = paginateCursor(filtered, {
      resource: "markets",
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      snapshot: typeof req.query.snapshot === "string" ? req.query.snapshot : undefined,
      secret: cursorSecret(),
      key: (listing) => listing.id,
      snapshotValue: () => "1970-01-01T00:00:00.000Z",
    });

    // Generate ETag based on the response payload
    const responsePayload = JSON.stringify(page);
    const etag = `"${crypto.createHash("md5").update(responsePayload).digest("hex")}"`;

    // Check conditional GET
    if (req.headers["if-none-match"] === etag) {
      // The client already has the latest version
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=5"); // Cache for a short time
    res.status(200).json(page);
  } catch (error: unknown) {
    if (error instanceof InvalidCursorError) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    // Top-level error boundary
    res.status(500).json({ error: "Internal server error fetching markets listing" });
  }
});
