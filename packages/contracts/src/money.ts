import { isKnownCurrency } from "@proofcore/core";
import { z } from "zod";

/**
 * Money over the wire is always `{ currency, minor }` with minor as a decimal
 * string. No float, ever, in any payload that a price can travel through.
 */
export const moneySchema = z
  .object({
    currency: z
      .string()
      .length(3)
      .refine((v) => isKnownCurrency(v), { message: "unknown currency code" }),
    minor: z.string().regex(/^-?\d+$/, "minor units must be an integer string"),
  })
  .strict();

export type MoneyJson = z.infer<typeof moneySchema>;

export const moneyInputSchema = z.union([
  moneySchema,
  z
    .object({
      currency: z.string().length(3),
      decimal: z.string().regex(/^-?\d+(\.\d+)?$/),
    })
    .strict(),
]);

export const periodSchema = z.enum(["monthly", "yearly"]);
export type BillingPeriod = z.infer<typeof periodSchema>;
