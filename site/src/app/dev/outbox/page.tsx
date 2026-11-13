import { notFound } from "next/navigation";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { outboxDir } from "@/lib/mail";

export const dynamic = "force-dynamic";

/** Caixa de saída de desenvolvimento: só existe fora de produção. */
export default function Outbox() {
  if (process.env.NODE_ENV === "production" && process.env.PREVIEW_MODE !== "1") notFound();
  const OUTBOX_DIR = outboxDir();
  const files = existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR).sort().reverse().slice(0, 20) : [];
  return (
    <main className="narrow">
      <h1>Caixa de saída (dev)</h1>
      {files.length === 0 && <p>Nenhum e-mail ainda.</p>}
      {files.map((f) => {
        const m = JSON.parse(readFileSync(join(OUTBOX_DIR, f), "utf8"));
        return <pre key={f} className="mail">Para: {m.to}{"\n"}Assunto: {m.subject}{"\n\n"}{m.text}</pre>;
      })}
    </main>
  );
}
