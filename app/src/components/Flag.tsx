/** Bandeira (flag-icons, MIT) em SVG local. `code` em minúsculas (ISO 3166-1 alfa-2). */
export default function Flag({ code, size = 20 }: { code: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="flag" src={`/flags/${code.toLowerCase()}.svg`} alt="" width={size} height={Math.round(size * 0.75)} loading="lazy" />;
}
