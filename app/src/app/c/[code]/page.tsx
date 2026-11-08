import { notFound } from "next/navigation";
import { CODE_RE, referrerByCode } from "@/lib/referrals";
import { config } from "@/lib/config";
import ShareLanding from "@/components/ShareLanding";
import { REDES, type Rede } from "@/content/compartilhar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compartilhar a petição", robots: { index: false, follow: false } };

/** Destino dos botões de compartilhar do e-mail: leva o cartaz pessoal + o texto com hashtags ao app escolhido. */
export default async function Compartilhar({ params, searchParams }: { params: { code: string }; searchParams: { r?: string } }) {
  const code = params.code.toUpperCase();
  if (!CODE_RE.test(code) || !(await referrerByCode(code))) notFound();
  const rede = (REDES as string[]).includes(searchParams.r ?? "") ? (searchParams.r as Rede) : "whatsapp";
  const base = config.appUrl().replace(/\/$/, "");
  return <ShareLanding code={code} rede={rede} link={`${base}/r/${code}`} />;
}
