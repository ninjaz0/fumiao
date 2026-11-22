import Home from "../home/Home";
import { originalUI } from "@fumiao/web-compat/ui";
export const dynamic = "force-dynamic";
export default async function Page() {
  return (
    <Home
      logo={`/static/mark.svg?v=${await originalUI().version("mark.svg")}`}
    />
  );
}
