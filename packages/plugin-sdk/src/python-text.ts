/** CPython str.strip whitespace (Unicode White_Space plus U+001C–001F).
 * BOM is deliberately retained. No normalization of interior text or URLs.
 */
export { pythonStrip } from "./python-values.js";
