import { NextRequest, NextResponse } from "next/server";
import { CODE_RE, referrerByCode } from "@/lib/referrals";
import { optedOut, recordEvent } from "@/lib/track";
import { clientIp, publicOrigin } from "@/lib/net";
import { config } from "@/lib/config";
import { newToken } from "@/lib/security";
import { cookieOpts } from "@/lib/cookies";

export const dynamic = "force-dynamic";
const PREVIEW_BOT = /(facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|pinterest|embedly)/i;

/** Link pessoal de indicação: registra o acesso, guarda o código do PRIMEIRO link (30 dias) e leva à página da petição. */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  // Robôs de pré-visualização (WhatsApp, Telegram, Facebook, X, LinkedIn…): recebem uma página com o cartaz pessoal como imagem do link (og:image).
  // Nada é registrado e não há redirecionamento, porque eles não executam a visita de uma pessoa.
  if (PREVIEW_BOT.test(req.headers.get("user-agent") ?? "") && CODE_RE.test(code) && (await referrerByCode(code))) {
    const origin = publicOrigin(req.headers, config.appUrl()).replace(/\/$/, "");
    const title = "Assine pela sanção integral do PLV 12/2026";
    const desc = "Educação federal pública na Amazônia Legal e na Faixa de Fronteira. Iniciativa da ADUNIR – Seção Sindical do ANDES-SN.";
    const img = `${origin}/api/cartaz/${code}.png`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${origin}/r/${code}"><meta property="og:image" content="${img}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1080"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:image" content="${img}"></head><body><a href="${origin}/">${title}</a></body></html>`;
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600" } });
  }
  const home = new URL("/", publicOrigin(req.headers, config.appUrl()));
  const res = NextResponse.redirect(home, 302);
  if (!CODE_RE.test(code) || !(await referrerByCode(code)) || optedOut(req.headers)) return res;
  let vid = req.cookies.get("vid")?.value;
  if (!vid) { vid = newToken().slice(0, 24); res.cookies.set("vid", vid, cookieOpts(req, 365 * 86400)); }
  // Primeiro toque: o primeiro link que a pessoa abriu é quem "trouxe" a pessoa; visitas posteriores a outros links só ficam nos eventos.
  if (!CODE_RE.test(req.cookies.get("ref")?.value ?? "")) res.cookies.set("ref", code, cookieOpts(req, 30 * 86400));
  await recordEvent({ visitorId: vid, type: "ref_visit", path: `/r/${code}`, refCode: code, ip: clientIp(req.headers), ua: req.headers.get("user-agent") ?? "", lang: req.headers.get("accept-language")?.split(",")[0] }).catch(() => {});
  return res;
}
