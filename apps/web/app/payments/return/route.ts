import { notFound } from "next/navigation";
import { originalMode, proxy } from "../../../proxy-backend";

export const dynamic = "force-dynamic";

function paymentReturn(request: Request) {
  if (!originalMode()) notFound();
  return proxy(request);
}

export const GET = paymentReturn,
  POST = paymentReturn,
  PUT = paymentReturn,
  PATCH = paymentReturn,
  DELETE = paymentReturn,
  HEAD = paymentReturn,
  OPTIONS = paymentReturn;
