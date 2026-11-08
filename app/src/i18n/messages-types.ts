import type { Messages, MessageKey } from "./pt";
import { fmt } from "./index";
export type { Messages, MessageKey };
export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
export const makeT = (m: Messages): T => (key, vars) => fmt(m[key] ?? key, vars);
