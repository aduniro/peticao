import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PresidentePortal from "@/components/presidente/PresidentePortal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Presidente da ADUNIR", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function PresidentePage() {
  if (process.env.PRESIDENT_OWN_ENABLED !== "1") notFound();
  return <PresidentePortal />;
}
