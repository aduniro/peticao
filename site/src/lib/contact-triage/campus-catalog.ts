import { IFES, SERVER_INSTITUTIONS } from "../ifes-data";
import { norm } from "../geo-data";

const key = (text: string) => norm(text).replace(/ /g, "");
const institutions = [...new Map([...IFES, ...SERVER_INSTITUTIONS].map(i => [i.s, i])).values()];
const byLabel = new Map(institutions.flatMap(i => [i.s, i.n, `${i.s} - ${i.n}`, ...(i.a ?? [])].map(label => [key(label), i] as const)));

/** Historical administrative references only. Never authorizes admission to the server form. */
export function findReferenceInstitution(text: string) {
  return typeof text === "string" ? byLabel.get(key(text.trim())) ?? null : null;
}
