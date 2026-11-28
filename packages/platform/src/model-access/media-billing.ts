import { creditUnits, formatCredits } from "../credit-amount.js";

export type DeliveredMedia = { images: number } | { milliseconds: number };
export function mediaCharge(
  rate: string,
  delivered: DeliveredMedia,
  held: string,
) {
  const count =
    "images" in delivered ? delivered.images : delivered.milliseconds;
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError("交付数量无效");
  const unit = creditUnits(rate),
    limit = creditUnits(held);
  if (unit < 0n || limit < 0n) throw new RangeError("媒体价格无效");
  const total = (unit * BigInt(count)) / ("images" in delivered ? 1n : 1000n);
  const charge = total < limit ? total : limit;
  return {
    charged: formatCredits(charge),
    waived: formatCredits(total - charge),
  };
}
