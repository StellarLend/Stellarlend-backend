/**
 * Data-access layer for `Notification` rows. Route code should go through
 * this module rather than importing `prisma` directly (see
 * `src/repositories/positionRepository.ts` for the same convention).
 *
 * Every function is scoped by `userId` and combines the ownership check with
 * the read/write in a single query (`updateMany`/`deleteMany` rather than
 * `findFirst` + `update`), so a notification owned by another user is
 * indistinguishable from one that doesn't exist at all — callers should map
 * a "not found or not owned" result to a generic 404.
 */
import type { Notification } from "@prisma/client";

import { prisma } from "../lib/prisma.js";

export function listNotificationsForUser(userId: string): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Marks a single notification as read. Returns `null` if no notification
 * with that id exists for this user (including one that exists but belongs
 * to someone else).
 */
export async function markNotificationAsRead(
  userId: string,
  id: string,
): Promise<Notification | null> {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });

  if (count === 0) {
    return null;
  }

  return prisma.notification.findUnique({ where: { id } });
}

/** Marks every unread notification for this user as read. Returns the number updated. */
export async function markAllNotificationsAsRead(userId: string): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });

  return count;
}

/**
 * Deletes a single notification. Returns `false` if no notification with
 * that id exists for this user (including one that exists but belongs to
 * someone else).
 */
export async function deleteNotification(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.notification.deleteMany({
    where: { id, userId },
  });

  return count > 0;
}
