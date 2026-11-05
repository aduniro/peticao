import type { Locale } from "@/i18n";

export type Audience = "servidor" | "apoiador" | "geral";

type Pack = { hook: Record<Audience, string>; body: string; wa: string; subject: string; email: string; share: string; by: string; thanks: string; hello: string; short: string };

/** Textos prontos de divulgação, por idioma. Baseados no PLV nº 12/2026 (MP 1.375/2026) e na Lei 12.855/2013. */
const P: Record<Locale, Pack> = {
  pt: {
    hook: { servidor: "Colega servidor(a) das universidades e institutos federais:", apoiador: "Você apoia a educação federal pública?", geral: "Educação federal pública precisa da sua assinatura:" },
    body: "O PLV nº 12/2026 inclui professores e técnicos-administrativos das IFES na Indenização de Localidades Estratégicas (R$ 191,00 por dia de efetivo trabalho, antes R$ 91,00) em todos os campi situados na Amazônia Legal e na Faixa de Fronteira. Está na mesa da Presidência: pedimos a SANÇÃO INTEGRAL, sem vetos à educação federal, e que o MGI adote um critério que contemple todos esses campi.",
    wa: "Sanção integral do PLV 12/2026", subject: "Assine: sanção integral do PLV 12/2026 (todos os campi das IFES na Amazônia Legal e na fronteira)",
    email: "A petição é da ADUNIR – Seção Sindical do ANDES-SN. Para assinar (leva cerca de 1 minuto):", share: "Compartilhe com colegas e apoiadores. Cada assinatura conta.", by: "Quem convida:", thanks: "Obrigado!", hello: "Olá,", short: "Assine pela sanção integral do PLV 12/2026:",
  } as Pack,
  en: {
    hook: { servidor: "Colleague at Brazil's federal universities and institutes:", apoiador: "Do you support federal public education?", geral: "Federal public education needs your signature:" },
    body: "PLV No. 12/2026 includes professors and technical staff of Brazil's federal higher-education institutions in the Strategic Locations Allowance (R$ 191.00 per day worked, up from R$ 91.00) at all campuses in the Legal Amazon and the Border Strip. It is on the President's desk: we ask for FULL SANCTION, with no vetoes to federal education, and for the MGI to adopt a criterion covering all these campuses.",
    wa: "Full sanction of PLV 12/2026", subject: "Sign: full sanction of PLV 12/2026 (all federal campuses in the Legal Amazon and the border strip)",
    email: "The petition is by ADUNIR – Union Section of ANDES-SN. To sign (about 1 minute):", share: "Share with colleagues and supporters. Every signature counts.", by: "Invited by:", thanks: "Thank you!", hello: "Hello,", short: "Sign for the full sanction of PLV 12/2026:",
  } as Pack,
  es: {
    hook: { servidor: "Colega de las universidades e institutos federales de Brasil:", apoiador: "¿Apoyas la educación federal pública?", geral: "La educación federal pública necesita tu firma:" },
    body: "El PLV n.º 12/2026 incluye a profesores y técnicos de las instituciones federales de educación superior de Brasil en la Indemnización de Localidades Estratégicas (R$ 191,00 por día trabajado, antes R$ 91,00) en todos los campus de la Amazonía Legal y la Franja de Frontera. Está en manos de la Presidencia: pedimos la SANCIÓN ÍNTEGRA, sin vetos a la educación federal, y que el MGI adopte un criterio que abarque todos esos campus.",
    wa: "Sanción íntegra del PLV 12/2026", subject: "Firma: sanción íntegra del PLV 12/2026 (todos los campus federales de la Amazonía Legal y la frontera)",
    email: "La petición es de ADUNIR – Sección Sindical de ANDES-SN. Para firmar (cerca de 1 minuto):", share: "Comparte con colegas y simpatizantes. Cada firma cuenta.", by: "Te invita:", thanks: "¡Gracias!", hello: "Hola,", short: "Firma por la sanción íntegra del PLV 12/2026:",
  } as Pack,
  fr: {
    hook: { servidor: "Collègue des universités et instituts fédéraux du Brésil :", apoiador: "Vous soutenez l'éducation publique fédérale ?", geral: "L'éducation publique fédérale a besoin de votre signature :" },
    body: "Le PLV n° 12/2026 inclut les enseignants et techniciens des établissements fédéraux d'enseignement supérieur du Brésil dans l'Indemnité de Localités Stratégiques (191,00 R$ par jour travaillé, contre 91,00 R$) dans tous les campus d'Amazonie légale et de la Zone frontalière. Il est sur le bureau de la Présidence : nous demandons la SANCTION INTÉGRALE, sans veto à l'éducation fédérale, et que le MGI adopte un critère couvrant tous ces campus.",
    wa: "Sanction intégrale du PLV 12/2026", subject: "Signez : sanction intégrale du PLV 12/2026 (tous les campus fédéraux d'Amazonie légale et de la frontière)",
    email: "La pétition est de l'ADUNIR – Section syndicale de l'ANDES-SN. Pour signer (environ 1 minute) :", share: "Partagez avec vos collègues et soutiens. Chaque signature compte.", by: "Invité par :", thanks: "Merci !", hello: "Bonjour,", short: "Signez pour la sanction intégrale du PLV 12/2026 :",
  } as Pack,
  de: {
    hook: { servidor: "Kolleg:in an den brasilianischen Bundesuniversitäten und -instituten:", apoiador: "Unterstützen Sie die öffentliche Bundesbildung?", geral: "Die öffentliche Bundesbildung braucht Ihre Unterschrift:" },
    body: "Das PLV Nr. 12/2026 nimmt Professor:innen und technisches Personal der brasilianischen Bundeshochschulen in die Zulage für strategische Standorte auf (R$ 191,00 pro Arbeitstag, bisher R$ 91,00), an allen Campus im Legalen Amazonasgebiet und im Grenzstreifen. Es liegt beim Präsidenten: Wir fordern die VOLLSTÄNDIGE SANKTIONIERUNG, ohne Vetos gegen die Bundesbildung, und dass das MGI ein Kriterium wählt, das alle diese Campus erfasst.",
    wa: "Vollständige Sanktionierung des PLV 12/2026", subject: "Unterschreiben: vollständige Sanktionierung des PLV 12/2026 (alle Bundescampus im Legalen Amazonasgebiet und im Grenzstreifen)",
    email: "Die Petition stammt von ADUNIR – Gewerkschaftssektion von ANDES-SN. Zum Unterschreiben (ca. 1 Minute):", share: "Teilen Sie sie mit Kolleg:innen und Unterstützer:innen. Jede Unterschrift zählt.", by: "Eingeladen von:", thanks: "Danke!", hello: "Guten Tag,", short: "Unterschreiben Sie für die vollständige Sanktionierung des PLV 12/2026:",
  } as Pack,
};

export function shareTexts(o: { link: string; firstName?: string | null; audience?: Audience; locale?: Locale; country?: string; cardUrl?: string }) {
  // No Brasil o texto de divulgação sai sempre em português, mesmo que a tela esteja em outro idioma.
  const p = P[o.country?.toUpperCase() === "BR" ? "pt" : o.locale ?? "pt"];
  const gancho = p.hook[o.audience ?? "geral"];
  const who = o.firstName ? ` ${p.by} ${o.firstName}.` : "";
  return {
    whatsapp: `*${p.wa}* \n\n${gancho}\n${p.body}\n\n${p.email}\n${o.link}`,
    emailSubject: p.subject,
    emailBody: `${p.hello}\n\n${gancho}\n\n${p.body}\n\n${p.email}\n${o.link}\n\n${p.share}${who}${o.cardUrl ? `\n\n${o.cardUrl}` : ""}\n\n${p.thanks}`,
    curto: `${p.short} ${o.link}`,
    short: p.short,
  };
}

/** Hashtags da campanha de assinaturas (usadas nos botões de compartilhar do e-mail e das páginas). */
export const HASHTAGS = ["#SancaoIntegral", "#PLV12", "#EducacaoFederal", "#AmazoniaLegal", "#ADUNIR"] as const;

/** Mensagem pronta de divulgação (português: o público da campanha é brasileiro), com hashtags e o link pessoal. */
export function campaignMessage(link: string): string {
  return `Assine pela sanção integral do PLV nº 12/2026! Educação federal pública na Amazônia Legal e na Faixa de Fronteira.\n${HASHTAGS.join(" ")}\n${link}`;
}

export type Rede = "whatsapp" | "telegram" | "x" | "facebook" | "instagram";
export const REDES: Rede[] = ["whatsapp", "telegram", "x", "facebook", "instagram"];

/** Endereço de compartilhamento de cada rede quando não dá para anexar o cartaz (a pré-visualização do link é o cartaz, pelo og:image do /r/CODIGO). */
export function redeUrl(rede: Exclude<Rede, "instagram">, link: string): string {
  const msg = campaignMessage(link);
  const enc = encodeURIComponent;
  switch (rede) {
    case "whatsapp": return `https://wa.me/?text=${enc(msg)}`;
    case "telegram": return `https://t.me/share/url?url=${enc(link)}&text=${enc(msg.split("\n").slice(0, 2).join("\n"))}`;
    case "x": return `https://x.com/intent/tweet?text=${enc("Assine pela sanção integral do PLV nº 12/2026!")}&url=${enc(link)}&hashtags=${enc(HASHTAGS.map((h) => h.slice(1)).join(","))}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}&hashtag=${enc(HASHTAGS[0])}`;
  }
}
