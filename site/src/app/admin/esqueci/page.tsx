import AdminEsqueci from "@/components/admin/AdminEsqueci";
import LoginMoldura from "@/components/admin/LoginMoldura";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Esqueci minha senha", robots: { index: false } };

export default function Esqueci() {
  return (
    <LoginMoldura titulo="Esqueci minha senha" sub="Informe o e-mail do seu cadastro. Se ele existir, enviamos um link para criar uma nova senha (vale 30 minutos)." pe={<a href="/admin">← Voltar ao acesso</a>}>
      <AdminEsqueci siteKey={turnstileEnabled() ? turnstileSiteKey() : null} />
    </LoginMoldura>
  );
}
