import AdminEsqueci from "@/components/admin/AdminEsqueci";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Esqueci minha senha", robots: { index: false } };

export default function Esqueci() {
  return (
    <main className="narrow">
      <h1>Esqueci minha senha</h1>
      <p className="small">Informe o e-mail do seu cadastro. Se ele existir, enviamos um link para criar uma nova senha (vale 30 minutos).</p>
      <AdminEsqueci siteKey={turnstileEnabled() ? turnstileSiteKey() : null} />
      <p style={{ marginTop: 12 }}><a href="/admin">← Voltar ao acesso</a></p>
    </main>
  );
}
