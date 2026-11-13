import type { Locale } from "@/i18n";
type Status = "pending" | "queued" | "accepted" | "duplicate" | "received" | "unknown" | "unavailable" | "rejected" | "network";
const copy: Record<Locale,Record<Status,string>> = {
  "pt": {
    "pending": "Estamos conferindo os dados. Nenhuma assinatura ou mensagem foi enviada ainda.",
    "queued": "Solicitação recebida. O e-mail está na fila de envio; aguarde a confirmação.",
    "accepted": "Solicitação recebida. O serviço de e-mail aceitou a mensagem; confira sua caixa de entrada e spam.",
    "duplicate": "Já recebemos uma solicitação com esses dados. Confira as mensagens anteriores. Nenhum novo e-mail foi enviado.",
    "received": "Solicitação recebida. O envio de um novo e-mail não foi confirmado; confira as mensagens anteriores.",
    "unknown": "Não foi possível confirmar o resultado agora. Confira seu e-mail antes de tentar novamente; não reenviamos automaticamente.",
    "unavailable": "A conferência está temporariamente indisponível. Nenhuma assinatura foi criada nesta etapa. Tente novamente em alguns minutos.",
    "rejected": "O nome informado não corresponde às fontes consultadas para este CPF. Confira os dados, corrija o que for necessário e tente novamente.",
    "network": "Não foi possível concluir a consulta agora. Tente novamente; uma falha de rede não significa que o link é inválido."
  },
  "en": {
    "pending": "We are checking your details. No signature or message has been submitted yet.",
    "queued": "Request received. The confirmation email is queued; please wait.",
    "accepted": "Request received. The email service accepted the message; check your inbox and spam folder.",
    "duplicate": "We have already received a request with these details. Check previous messages. No new email was sent.",
    "received": "Request received. A new email has not been confirmed; check previous messages.",
    "unknown": "We could not confirm the result. Check your email before trying again; we do not resend automatically.",
    "unavailable": "Verification is temporarily unavailable. No signature was created at this stage. Try again in a few minutes.",
    "rejected": "The name does not match the sources checked for this CPF. Review and correct your details, then try again.",
    "network": "We could not complete the check. Try again; a network failure does not mean the link is invalid."
  },
  "es": {
    "pending": "Estamos comprobando los datos. Todavía no se registró ninguna firma ni se envió un mensaje.",
    "queued": "Solicitud recibida. El correo de confirmación está en la cola de envío; espere.",
    "accepted": "Solicitud recibida. El servicio de correo aceptó el mensaje; revise su bandeja y spam.",
    "duplicate": "Ya recibimos una solicitud con estos datos. Revise los mensajes anteriores. No se envió otro correo.",
    "received": "Solicitud recibida. No se ha confirmado un nuevo correo; revise los mensajes anteriores.",
    "unknown": "No pudimos confirmar el resultado. Revise su correo antes de intentarlo de nuevo; no reenviamos automáticamente.",
    "unavailable": "La comprobación no está disponible temporalmente. No se registró ninguna firma en esta etapa. Inténtelo de nuevo en unos minutos.",
    "rejected": "El nombre no coincide con las fuentes consultadas para este CPF. Revise los datos, corríjalos e inténtelo de nuevo.",
    "network": "No pudimos completar la consulta. Inténtelo de nuevo; un fallo de red no significa que el enlace sea inválido."
  },
  "fr": {
    "pending": "Nous vérifions vos informations. Aucune signature ni aucun message n’a encore été envoyé.",
    "queued": "Demande reçue. Le courriel de confirmation est en attente d’envoi.",
    "accepted": "Demande reçue. Le service de messagerie a accepté le message ; vérifiez votre boîte et les indésirables.",
    "duplicate": "Une demande avec ces informations a déjà été reçue. Consultez les messages précédents. Aucun nouveau courriel n’a été envoyé.",
    "received": "Demande reçue. L’envoi d’un nouveau courriel n’a pas été confirmé ; consultez les messages précédents.",
    "unknown": "Le résultat n’a pas pu être confirmé. Vérifiez vos courriels avant de réessayer ; aucun renvoi automatique n’est effectué.",
    "unavailable": "La vérification est temporairement indisponible. Aucune signature n’a été créée à cette étape. Réessayez dans quelques minutes.",
    "rejected": "Le nom ne correspond pas aux sources consultées pour ce CPF. Vérifiez et corrigez vos informations, puis réessayez.",
    "network": "La vérification n’a pas abouti. Réessayez ; une panne réseau ne signifie pas que le lien est invalide."
  },
  "de": {
    "pending": "Ihre Angaben werden geprüft. Es wurde noch keine Unterschrift registriert und keine Nachricht gesendet.",
    "queued": "Anfrage erhalten. Die Bestätigungs-E-Mail wartet auf den Versand. Bitte warten Sie.",
    "accepted": "Anfrage erhalten. Der E-Mail-Dienst hat die Nachricht angenommen. Prüfen Sie Posteingang und Spamordner.",
    "duplicate": "Eine Anfrage mit diesen Angaben liegt bereits vor. Prüfen Sie frühere Nachrichten. Es wurde keine neue E-Mail gesendet.",
    "received": "Anfrage erhalten. Der Versand einer neuen E-Mail wurde nicht bestätigt. Prüfen Sie frühere Nachrichten.",
    "unknown": "Das Ergebnis konnte nicht bestätigt werden. Prüfen Sie Ihre E-Mails, bevor Sie es erneut versuchen. Wir senden nicht automatisch erneut.",
    "unavailable": "Die Prüfung ist vorübergehend nicht verfügbar. In diesem Schritt wurde keine Unterschrift registriert. Versuchen Sie es in einigen Minuten erneut.",
    "rejected": "Der Name stimmt mit den für diese CPF geprüften Quellen nicht überein. Prüfen und korrigieren Sie Ihre Angaben und versuchen Sie es erneut.",
    "network": "Die Prüfung konnte nicht abgeschlossen werden. Versuchen Sie es erneut. Ein Netzwerkfehler bedeutet nicht, dass der Link ungültig ist."
  }
};
export function signupStatusCopy(lang:string,key:Status):string { return (copy[lang as Locale]??copy.en)[key]; }
export function signupOutcomeCopy(lang:string,data:{submission?:unknown;mail?:unknown}):string {
  return signupStatusCopy(lang,data.submission==="already_received"?"duplicate":data.mail==="queued"?"queued":data.mail==="sent"?"accepted":"received");
}
