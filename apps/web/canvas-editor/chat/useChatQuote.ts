import { useEffect, useRef, useState } from "react";
import { creditUnits } from "@fumiao/plugin-sdk/credit-amount.js";

export type ChatQuote = {
  max_charge: string;
  max_output_tokens: number;
  price_revision: string;
  route_revision: string;
  quote_context: string;
};
export function useChatQuote(
  key: string | null,
  load: () => Promise<ChatQuote>,
) {
  const loader = useRef(load);
  loader.current = load;
  const [version, refresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    version: number;
    quote?: ChatQuote;
    error?: string;
  }>();
  useEffect(() => {
    if (!key) return;
    let current = true;
    const timer = setTimeout(() => {
      void loader.current().then(
        (quote) => {
          if (current) setResult({ key, version, quote });
        },
        (e) => {
          if (current) setResult({ key, version, error: (e as Error).message });
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, version]);
  const active =
    result?.key === key && result.version === version ? result : undefined;
  return {
    quote: active?.quote,
    error: active?.error,
    refresh: () => refresh((v) => v + 1),
  };
}
export function quoteFunded(
  available: string | undefined,
  numeric: number,
  price: string | number | null | undefined,
) {
  if (price == null) return false;
  if (available === undefined || typeof price === "number")
    return numeric >= Number(price);
  return creditUnits(available) >= creditUnits(price);
}
