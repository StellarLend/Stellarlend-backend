import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const walletAddress = "G" + "A".repeat(55);

describe("protocol input HTTP boundary", () => {
  it("rejects malformed lending input before the placeholder action handler", async () => {
    const response = await request(createApp())
      .post("/api/v1/lending/borrow")
      .send({ walletAddress, amount: "-1" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "INVALID_AMOUNT", field: "amount" });
  });

  it("rejects unsupported protocol network before any action response", async () => {
    const response = await request(createApp())
      .post("/api/v1/lending/deposit")
      .send({ walletAddress, amount: "1", network: "devnet" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "UNSUPPORTED_NETWORK", field: "network" });
  });

  it("passes valid input through to the existing action boundary", async () => {
    const response = await request(createApp())
      .post("/api/v1/lending/repay")
      .send({ walletAddress, amount: "1", asset: "XLM", network: "testnet" });
    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe("NOT_IMPLEMENTED");
  });

  it.each(["deposit", "borrow", "repay", "withdraw", "liquidate"])(
    "guards every lending action: %s",
    async (action) => {
      const response = await request(createApp())
        .post(`/api/v1/lending/${action}`)
        .send({ walletAddress, amount: "0" });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: "INVALID_AMOUNT", field: "amount" });
    },
  );

  it("returns only the stable validation envelope for malformed fields", async () => {
    const response = await request(createApp())
      .post("/api/v1/lending/borrow")
      .send({ walletAddress, amount: "1", deadline: "not-a-number" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_DEADLINE");
    expect(JSON.stringify(response.body)).not.toContain("TypeError");
    expect(JSON.stringify(response.body)).not.toContain("node_modules");
  });
});
