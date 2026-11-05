// Quem é o dono para a ponte: os três endereços do responsável pela ADUNIR. Um e-mail só vale como pedido do dono se vier de um desses endereços
// COM DKIM aprovado do MESMO domínio do endereço (Gmail assina como gmail.com, o pm.me como pm.me, o Proton como protonmail.com). Domínio "parente" não vale.
export const ENDERECOS_DONO = ["operator-1608598f41@example.invalid", "operator-a07ab58f08@example.invalid", "operator-3851f407d1@example.invalid"];
export const enderecoDe = (m) => String(m.de ?? "").toLowerCase().replace(/^.*</, "").replace(/>.*$/, "").trim();
export function doDono(m) {
  const de = enderecoDe(m);
  if (!ENDERECOS_DONO.includes(de)) return false;
  const dominio = de.split("@")[1].replace(/\./g, "\\.");
  const auth = String(m.auth ?? "");
  return /dkim=pass/i.test(auth) && new RegExp(`header\\.d=${dominio}(?![\\w.-])`, "i").test(auth);
}
