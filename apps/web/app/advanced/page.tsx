import { notFound } from "next/navigation";
import Studio from "../../advanced/Studio";
export const dynamic = "force-dynamic";
export default function Advanced() {
  if (process.env.STUDIO_MODE !== "advanced") notFound();
  return <Studio />;
}
