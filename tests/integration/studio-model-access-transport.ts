// Loaded only into the child processes of the disposable Studio test.
// Route one reserved HTTPS hostname to the test's HTTP listener. Leave every
// other request (including S3, payment and legacy providers) on its own transport.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

dns.lookup = new Proxy(dns.lookup, {
  apply(lookup, self, args) {
    const [hostname, options] = args;
    if (hostname !== "model-access.invalid")
      return Reflect.apply(lookup, self, args);
    // The admitted address is never dialed. Only the HTTPS hook below handles this host.
    const record = { address: "93.184.216.34", family: 4 };
    return Promise.resolve(options?.all ? [record] : record);
  },
});
https.request = new Proxy(https.request, {
  apply(request, self, args) {
    const [url, options, callback] = args;
    if (!(url instanceof URL) || url.origin !== "https://model-access.invalid")
      return Reflect.apply(request, self, args);
    const target = new URL(process.env.STUDIO_MODEL_FIXTURE!);
    if (target.protocol !== "http:" || target.hostname !== "127.0.0.1")
      throw new Error("Expected the disposable loopback model provider");
    target.pathname = url.pathname;
    target.search = url.search;
    return http.request(
      target,
      {
        method: options.method,
        signal: options.signal,
        headers: { ...options.headers, host: url.host },
      },
      callback,
    );
  },
});
syncBuiltinESMExports();
