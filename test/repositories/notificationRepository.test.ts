import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../src/lib/prisma.js";
import {
  deleteNotification,
  listNotificationsForUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../../src/repositories/notificationRepository.js";

const notificationFindMany = vi.mocked(prisma.notification.findMany);
const notificationUpdateMany = vi.mocked(prisma.notification.updateMany);
const notificationFindUnique = vi.mocked(prisma.notification.findUnique);
const notificationDeleteMany = vi.mocked(prisma.notification.deleteMany);

describe("notificationRepository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("listNotificationsForUser", () => {
    it("queries by userId, newest first", async () => {
      notificationFindMany.mockResolvedValue([]);

      await listNotificationsForUser("user-1");

      expect(notificationFindMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns an empty array for a user with no notifications", async () => {
      notificationFindMany.mockResolvedValue([]);

      const result = await listNotificationsForUser("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("markNotificationAsRead", () => {
    it("scopes the update by id and userId together, then refetches on success", async () => {
      notificationUpdateMany.mockResolvedValue({ count: 1 });
      const stored = { id: "notif-1", userId: "user-1", read: true } as never;
      notificationFindUnique.mockResolvedValue(stored);

      const result = await markNotificationAsRead("user-1", "notif-1");

      expect(notificationUpdateMany).toHaveBeenCalledWith({
        where: { id: "notif-1", userId: "user-1" },
        data: { read: true },
      });
      expect(notificationFindUnique).toHaveBeenCalledWith({ where: { id: "notif-1" } });
      expect(result).toBe(stored);
    });

    it("returns null without refetching when nothing matched (missing or not owned)", async () => {
      notificationUpdateMany.mockResolvedValue({ count: 0 });

      const result = await markNotificationAsRead("user-1", "someone-elses-notif");

      expect(result).toBeNull();
      expect(notificationFindUnique).not.toHaveBeenCalled();
    });
  });

  describe("markAllNotificationsAsRead", () => {
    it("only updates this user's unread notifications and returns the count", async () => {
      notificationUpdateMany.mockResolvedValue({ count: 3 });

      const count = await markAllNotificationsAsRead("user-1");

      expect(notificationUpdateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", read: false },
        data: { read: true },
      });
      expect(count).toBe(3);
    });

    it("returns 0 when there is nothing to mark as read", async () => {
      notificationUpdateMany.mockResolvedValue({ count: 0 });

      const count = await markAllNotificationsAsRead("user-1");

      expect(count).toBe(0);
    });
  });

  describe("deleteNotification", () => {
    it("scopes the delete by id and userId, returns true on success", async () => {
      notificationDeleteMany.mockResolvedValue({ count: 1 });

      const result = await deleteNotification("user-1", "notif-1");

      expect(notificationDeleteMany).toHaveBeenCalledWith({
        where: { id: "notif-1", userId: "user-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when nothing matched (missing or not owned)", async () => {
      notificationDeleteMany.mockResolvedValue({ count: 0 });

      const result = await deleteNotification("user-1", "someone-elses-notif");

      expect(result).toBe(false);
    });
  });
});
