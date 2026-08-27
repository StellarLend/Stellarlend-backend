import { z } from "zod";

export const SUPPORTED_ASSETS = ["XLM", "USDC", "EURC"] as const;
export const SUPPORTED_NETWORKS = ["testnet", "mainnet"] as const;
export const MAX_AMOUNT = 10n ** 30n;
export const MAX_DEADLINE_SECONDS = 30 * 24 * 60 * 60;

export type ProtocolInputErrorCode =
  | "INVALID_FIELD"
  | "UNSUPPORTED_ASSET"
  | "UNSUPPORTED_NETWORK"
  | "INVALID_AMOUNT"
  | "INVALID_DEADLINE"
  | "AMOUNT_OUT_OF_RANGE";

export class ProtocolInputError extends Error {
  constructor(
    public readonly code: ProtocolInputErrorCode,
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolInputError";
  }
}

export type ParsedProtocolAmount = {
  raw: string;
  units: bigint;
  decimals: number;
};

export type ProtocolInput = {
  walletAddress: string;
  amount: ParsedProtocolAmount;
  asset: (typeof SUPPORTED_ASSETS)[number];
  network: (typeof SUPPORTED_NETWORKS)[number];
  deadline: number;
};

const walletPattern = /^G[A-Z2-7]{55}$/;
const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

function invalid(
  field: string,
  message: string,
  code: ProtocolInputErrorCode = "INVALID_FIELD",
): never {
  throw new ProtocolInputError(code, field, message);
}

/** Parse a decimal protocol amount without floating-point conversion. */
export function parseProtocolAmount(value: unknown): ParsedProtocolAmount {
  if (typeof value !== "string" || value.length === 0)
    invalid("amount", "amount must be a decimal string", "INVALID_AMOUNT");
  if (!amountPattern.test(value))
    invalid("amount", "amount must use at most 7 decimal places", "INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  if (whole === undefined) invalid("amount", "amount must be a decimal string", "INVALID_AMOUNT");
  const units = BigInt(whole) * 10n ** 7n + BigInt(fraction.padEnd(7, "0"));
  if (units <= 0n) invalid("amount", "amount must be greater than zero", "INVALID_AMOUNT");
  if (units >= MAX_AMOUNT * 10n ** 7n)
    invalid("amount", "amount exceeds protocol maximum", "AMOUNT_OUT_OF_RANGE");
  return { raw: value, units, decimals: fraction.length };
}

export function parseAsset(value: unknown): (typeof SUPPORTED_ASSETS)[number] {
  if (
    typeof value !== "string" ||
    !SUPPORTED_ASSETS.includes(value as (typeof SUPPORTED_ASSETS)[number])
  ) {
    invalid("asset", "asset is not supported", "UNSUPPORTED_ASSET");
  }
  return value as (typeof SUPPORTED_ASSETS)[number];
}

export function parseNetwork(value: unknown): (typeof SUPPORTED_NETWORKS)[number] {
  if (
    typeof value !== "string" ||
    !SUPPORTED_NETWORKS.includes(value as (typeof SUPPORTED_NETWORKS)[number])
  ) {
    invalid("network", "network must be testnet or mainnet", "UNSUPPORTED_NETWORK");
  }
  return value as (typeof SUPPORTED_NETWORKS)[number];
}

export function parseDeadline(value: unknown, nowSeconds = Math.floor(Date.now() / 1_000)): number {
  const deadline = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof deadline !== "number" || !Number.isSafeInteger(deadline))
    invalid("deadline", "deadline must be a safe integer timestamp", "INVALID_DEADLINE");
  if (deadline < nowSeconds)
    invalid("deadline", "deadline cannot be in the past", "INVALID_DEADLINE");
  if (deadline > nowSeconds + MAX_DEADLINE_SECONDS)
    invalid("deadline", "deadline exceeds the maximum window", "INVALID_DEADLINE");
  return deadline;
}

/** Parse the complete request once, before authentication/ledger side effects are invoked. */
export function parseProtocolInput(
  value: unknown,
  nowSeconds = Math.floor(Date.now() / 1_000),
): ProtocolInput {
  const result = z
    .object({
      walletAddress: z.string().min(1).max(56),
      amount: z.unknown(),
      asset: z.unknown().optional().default("XLM"),
      network: z.unknown().optional().default("testnet"),
      deadline: z
        .unknown()
        .optional()
        .default(nowSeconds + 60),
    })
    .safeParse(value);
  if (!result.success) {
    const field = result.error.issues[0]?.path[0];
    invalid(typeof field === "string" ? field : "body", "request field is invalid");
  }
  if (!walletPattern.test(result.data.walletAddress)) {
    invalid("walletAddress", "walletAddress must be a valid Stellar public address");
  }
  return {
    walletAddress: result.data.walletAddress,
    amount: parseProtocolAmount(result.data.amount),
    asset: parseAsset(result.data.asset),
    network: parseNetwork(result.data.network),
    deadline: parseDeadline(result.data.deadline, nowSeconds),
  };
}

/** Express boundary with a stable field-aware error envelope. */
export function validateProtocolInput(
  req: { body?: unknown },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: () => void,
): void {
  try {
    req.body = parseProtocolInput(req.body);
    next();
  } catch (error) {
    if (error instanceof ProtocolInputError) {
      res
        .status(400)
        .json({ error: { code: error.code, field: error.field, message: error.message } });
      return;
    }
    res.status(400).json({
      error: { code: "INVALID_FIELD", field: "body", message: "protocol input is invalid" },
    });
  }
}
