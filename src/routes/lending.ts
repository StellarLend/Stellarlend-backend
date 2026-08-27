/**
 * Core lending-action routes: deposit, borrow, repay, withdraw, liquidate.
 *
 * Placeholder — these will build/simulate/submit Soroban transactions via the
 * Stellar integration service (`src/services/stellar`) once that lands. For
 * now they respond `501 Not Implemented` with a stable error envelope so the
 * routes are real and reachable (not 404s) while the frontend integrates
 * against this API surface.
 */
import { Router, type Request, type Response } from "express";
import { validateProtocolInput } from "../validation/protocolInput.js";

export const lendingRouter = Router();

const ACTIONS = ["deposit", "borrow", "repay", "withdraw", "liquidate"] as const;

function notImplemented(action: (typeof ACTIONS)[number]) {
  return (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: `The "${action}" lending action is not implemented yet.`,
      },
    });
  };
}

for (const action of ACTIONS) {
  lendingRouter.post(`/${action}`, validateProtocolInput, notImplemented(action));
}
