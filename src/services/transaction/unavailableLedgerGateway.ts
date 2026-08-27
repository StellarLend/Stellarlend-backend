import type {
  LedgerGateway,
  LedgerObservation,
  LedgerSubmission,
  TransactionOperation,
} from "./types.js";

/**
 * Safe default until the network adapter is configured by the deployment.
 * Requests are recorded as retryable failures rather than falsely reported as
 * submitted, which is the only safe behavior when ledger connectivity is
 * unavailable.
 */
export class UnavailableLedgerGateway implements LedgerGateway {
  async submit(_operation: TransactionOperation): Promise<LedgerSubmission> {
    throw new Error("Stellar ledger submission is not configured.");
  }

  async inspect(_operation: TransactionOperation): Promise<LedgerObservation> {
    return {
      state: "retryable_failed",
      code: "LEDGER_UNAVAILABLE",
      message: "Stellar ledger status is not available yet.",
    };
  }
}
