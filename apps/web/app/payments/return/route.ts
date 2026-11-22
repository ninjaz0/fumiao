import { proxy } from "../../../proxy-backend";

export const dynamic = "force-dynamic";

function paymentReturn(request: Request) {
  return proxy(request);
}

export const GET = paymentReturn,
  POST = paymentReturn,
  PUT = paymentReturn,
  PATCH = paymentReturn,
  DELETE = paymentReturn,
  HEAD = paymentReturn,
  OPTIONS = paymentReturn;
