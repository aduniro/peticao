import type { DomainKind } from "./institutional";

/** Explicit owner-approved exception; EBSERH is not classified as an IFES. */
export const EBSERH = {
  name: "Empresa Brasileira de Serviços Hospitalares",
  acronym: "EBSERH",
  domains: ["ebserh.gov.br", "hubrasil.gov.br"],
} as const;
export const SERVER_EMAIL_POLICY_VERSION = "2026-11-08.approved-ifes-ebserh-v2";
export const acceptsServerDomain = (kind: DomainKind | null | undefined, domain?: string | null): boolean =>
  kind === "ifes" || EBSERH.domains.some(d => d === domain?.trim().toLowerCase());
