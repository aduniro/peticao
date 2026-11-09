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


/** Cor do texto com contraste sobre um fundo hexadecimal (#rrggbb). */
export function textoSobre(hex: string): string {
  const n = parseInt(hex.slice(1), 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#10241a" : "#ffffff";
}
