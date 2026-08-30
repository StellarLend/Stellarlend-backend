import { Router, type Request, type Response } from "express";
import { listActivity } from "../services/activityService.js";

export const activityRouter = Router();

activityRouter.get("/", (req: Request, res: Response) => {
  const page = listActivity({
    account: typeof req.query.account === "string" ? req.query.account : undefined,
    assetId: typeof req.query.assetId === "string" ? req.query.assetId : undefined,
    type: typeof req.query.type === "string" ? req.query.type : undefined,
    limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
    cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    snapshot: typeof req.query.snapshot === "string" ? req.query.snapshot : undefined,
  });
  res.status(200).json(page);
});
