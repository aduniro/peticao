import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Minha assinatura — PLV 12/2026",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};
export const dynamic = "force-dynamic";
export default function SubscriberLayout({ children }: { children: React.ReactNode }) {
  if (process.env.SUBSCRIBER_ACCESS_ENABLED !== "1") notFound();
  return children;
}
