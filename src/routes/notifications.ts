/**
 * Notifications CRUD routes backing the frontend notification bell: list,
 * mark-as-read, mark-all-as-read, delete. All routes are scoped to the
 * caller — see `src/middleware/requireUserId.ts` for how the caller is
 * identified until real session auth lands — and reads/deletes of another
 * user's notification return a generic 404 rather than a 403, so existence
 * is never leaked across accounts.
 */
import { Router, type Request, type Response } from "express";

import { asyncHandler } from "../lib/asyncHandler.js";
import { AppError } from "../middleware/errorHandler.js";
import { requireUserId } from "../middleware/requireUserId.js";
import {
  deleteNotification,
  listNotificationsForUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../repositories/notificationRepository.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireUserId);

notificationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const notifications = await listNotificationsForUser(req.userId!);
    res.status(200).json({ notifications });
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req: Request, res: Response) => {
    const count = await markAllNotificationsAsRead(req.userId!);
    res.status(200).json({ count });
  }),
);

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req: Request, res: Response) => {
    const notification = await markNotificationAsRead(req.userId!, req.params.id as string);

    if (!notification) {
      throw new AppError("NOT_FOUND", "Notification not found.", 404);
    }

    res.status(200).json({ notification });
  }),
);

notificationsRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteNotification(req.userId!, req.params.id as string);

    if (!deleted) {
      throw new AppError("NOT_FOUND", "Notification not found.", 404);
    }

    res.status(204).send();
  }),
);
