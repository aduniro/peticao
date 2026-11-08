import type { DomainKind } from "./institutional";

/** Only domains explicitly approved as federal education qualify for new servidor requests. */
export const SERVER_EMAIL_POLICY_VERSION = "2026-11-08.approved-ifes-only-v1";
export const acceptsServerDomain = (kind: DomainKind | null | undefined): boolean => kind === "ifes";
