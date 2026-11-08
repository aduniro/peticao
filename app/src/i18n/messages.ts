import { pt } from "./pt";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { de } from "./de";
import type { Locale } from "./index";
import type { Messages } from "./messages-types";

export { makeT } from "./messages-types";
export type { Messages, MessageKey, T } from "./messages-types";
export const DICTS: Record<Locale, Messages> = { pt, en, es, fr, de };
