import raw from "../../public/data/ebserh-units.json";

/** Unidades operacionais da rede e sede administrativa; complexos agregadores não são opções duplicadas. */
export type EbserhUnit = {
  id: string;
  acronym: string;
  name: string;
  municipalityIbge: number;
  city: string;
  uf: string;
  type: "hospital" | "hospital_componente" | "sede";
  parentId: string | null;
  evidenceUrl: string;
};
export const EBSERH_UNITS: readonly EbserhUnit[] = raw as EbserhUnit[];
const byId = new Map(EBSERH_UNITS.map((unit) => [unit.id, unit]));
/** Identificador exato de unidade: nomes, cidades e IDs aproximados nunca autorizam seleção. */
export function findEbserhUnit(id: string | null | undefined): EbserhUnit | null {
  return typeof id === "string" ? byId.get(id) ?? null : null;
}
