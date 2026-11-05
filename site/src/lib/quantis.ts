// Degradê do mapa de estados: vermelho (menos) → cinza neutro → azul (mais), em classes por quantis dos valores maiores que zero.
export const RAMPA = ["#e34948", "#f0a5a4", "#d4d4d0", "#9cc0ec", "#2a78d6"];

export function quantis(valores: number[], k = 5): number[] {
  const v = valores.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const cortes: number[] = [];
  for (let i = 1; i < k; i++) cortes.push(v[Math.min(v.length - 1, Math.floor((i * v.length) / k))]);
  return cortes;
}
export const classe = (n: number, cortes: number[]) => (n <= 0 ? -1 : Math.min(RAMPA.length - 1, cortes.filter((c) => n >= c).length));

