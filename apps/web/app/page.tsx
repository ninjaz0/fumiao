import Home from "../home/Home";
import { originalUI } from "../../../packages/web-compat/src/ui";
export const dynamic = "force-dynamic";
export default async function Page() {
  return (
    <Home
      logo={`/static/mark.svg?v=${await originalUI().version("mark.svg")}`}
    />
  );
}
