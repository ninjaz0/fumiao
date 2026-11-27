import { useEffect, useState } from "react";
import { api } from "./api";
import type { MediaQuote } from "../studio/state";

type Quote = { authorization?: MediaQuote; error?: string };
type Item = {
  kind: string;
  model: string;
  params: Record<string, unknown>;
  refs: string[];
  canvas_tail?: { project: string; parent: string };
  count: number;
};

export function useMediaQuote(
  item: Item | null,
  workspace: number,
  revision: number,
  parentRun?: { id: number; status: string; result: string | null },
) {
  const request = item && JSON.stringify({ items: [item] });
  const key = request && JSON.stringify([workspace, revision, request, parentRun?.id, parentRun?.status, parentRun?.result]);
  const [result, setResult] = useState<Quote & { key: string }>();
  useEffect(() => {
    if (!key || !request) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await api<{
            price_revision: number;
            items: {
              allowed: boolean;
              priced: boolean;
              reason?: string;
              exact_credits: string;
              route_revision?: string;
              price_revision_id?: string;
            }[];
          }>("/api/quotes/batch", JSON.parse(request));
          const item = response.items[0];
          const quote =
            item?.allowed &&
            item.priced &&
            item.route_revision &&
            item.price_revision_id
              ? {
                  authorization: {
                    price_revision: response.price_revision,
                    route_revision: item.route_revision,
                    price_revision_id: item.price_revision_id,
                    max_charge: item.exact_credits,
                  },
                }
              : { error: item?.reason || "无法取得当前线路报价" };
          if (live) setResult({ key, ...quote });
        } catch (error) {
          if (live) setResult({ key, error: (error as Error).message });
        }
      })();
    }, 160);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request, key]);
  return result?.key === key ? result : undefined;
}
