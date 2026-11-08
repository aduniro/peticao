export type UaInfo = { os: string; browser: string; device: "celular" | "tablet" | "computador" | "robô"; isBot: boolean };

const BOT = /bot|crawler|spider|crawling|slurp|facebookexternalhit|whatsapp|telegram|preview|curl|wget|python-requests|httpclient|headless|lighthouse|monitor|uptime|go-http|axios|node-fetch/i;

/** Parser pequeno e suficiente para o painel (sem dependências com licenças restritivas). */
export function parseUa(ua: string): UaInfo {
  const u = ua || "";
  const isBot = !u || BOT.test(u);
  let os = "Outro";
  if (/Windows NT/i.test(u)) os = "Windows";
  else if (/Android/i.test(u)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(u)) os = "iOS";
  else if (/CrOS/i.test(u)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/i.test(u)) os = "macOS";
  else if (/Linux|X11/i.test(u)) os = "Linux";
  let browser = "Outro";
  if (/SamsungBrowser/i.test(u)) browser = "Samsung Internet";
  else if (/Edg(e|A|iOS)?\//i.test(u)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(u)) browser = "Opera";
  else if (/Firefox|FxiOS/i.test(u)) browser = "Firefox";
  else if (/CriOS|Chrome\//i.test(u)) browser = "Chrome";
  else if (/Safari\//i.test(u)) browser = "Safari";
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(u);
  const mobile = /Mobi|iPhone|iPod|Android.*Mobile/i.test(u);
  const device = isBot ? "robô" : tablet ? "tablet" : mobile ? "celular" : "computador";
  return { os, browser, device, isBot };
}
