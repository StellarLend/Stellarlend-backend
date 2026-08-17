import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/repositories/notificationRepository.js", () => ({
  listNotificationsForUser: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

import { createApp } from "../../src/app.js";
import {
  deleteNotification,
  listNotificationsForUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../../src/repositories/notificationRepository.js";

const listNotificationsForUserMock = vi.mocked(listNotificationsForUser);
const markNotificationAsReadMock = vi.mocked(markNotificationAsRead);
const markAllNotificationsAsReadMock = vi.mocked(markAllNotificationsAsRead);
const deleteNotificationMock = vi.mocked(deleteNotification);

const app = createApp();

describe("/api/v1/notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("auth", () => {
    it("rejects requests without an X-User-Id header with 401", async () => {
      const response = await request(app).get("/api/v1/notifications");

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
      expect(listNotificationsForUserMock).not.toHaveBeenCalled();
    });
  });

  describe("GET /", () => {
    it("returns an empty list for a new user, not an error", async () => {
      listNotificationsForUserMock.mockResolvedValue([]);

      const response = await request(app).get("/api/v1/notifications").set("X-User-Id", "user-1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ notifications: [] });
      expect(listNotificationsForUserMock).toHaveBeenCalledWith("user-1");
    });

    it("returns the caller's notifications", async () => {
      const notifications = [
        {
          id: "notif-1",
          userId: "user-1",
          title: "Position liquidated",
          message: "Your XLM position was liquidated.",
          type: "liquidation",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ];
      listNotificationsForUserMock.mockResolvedValue(notifications as never);

      const response = await request(app).get("/api/v1/notifications").set("X-User-Id", "user-1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ notifications });
    });
  });

  describe("POST /:id/read", () => {
    it("marks a notification as read", async () => {
      const notification = {
        id: "notif-1",
        userId: "user-1",
        title: "t",
        message: "m",
        type: "info",
        read: true,
        createdAt: new Date().toISOString(),
      };
      markNotificationAsReadMock.mockResolvedValue(notification as never);

      const response = await request(app)
        .post("/api/v1/notifications/notif-1/read")
        .set("X-User-Id", "user-1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ notification });
      expect(markNotificationAsReadMock).toHaveBeenCalledWith("user-1", "notif-1");
    });

    it("returns 404 for a notification that does not exist or belongs to someone else", async () => {
      markNotificationAsReadMock.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/v1/notifications/not-mine/read")
        .set("X-User-Id", "user-1");

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    });
  });

  describe("POST /read-all", () => {
    it("marks every unread notification as read and returns the count", async () => {
      markAllNotificationsAsReadMock.mockResolvedValue(5);

      const response = await request(app)
        .post("/api/v1/notifications/read-all")
        .set("X-User-Id", "user-1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 5 });
      expect(markAllNotificationsAsReadMock).toHaveBeenCalledWith("user-1");
    });

    it("returns a count of 0 when there is nothing to mark as read", async () => {
      markAllNotificationsAsReadMock.mockResolvedValue(0);

      const response = await request(app)
        .post("/api/v1/notifications/read-all")
        .set("X-User-Id", "user-1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0 });
    });
  });

  describe("DELETE /:id", () => {
    it("deletes a notification owned by the caller", async () => {
      deleteNotificationMock.mockResolvedValue(true);

      const response = await request(app)
        .delete("/api/v1/notifications/notif-1")
        .set("X-User-Id", "user-1");

      expect(response.status).toBe(204);
      expect(deleteNotificationMock).toHaveBeenCalledWith("user-1", "notif-1");
    });

    it("returns 404, not 403, when deleting a notification that isn't the caller's", async () => {
      deleteNotificationMock.mockResolvedValue(false);

      const response = await request(app)
        .delete("/api/v1/notifications/someone-elses")
        .set("X-User-Id", "user-1");

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    });
  });
});
