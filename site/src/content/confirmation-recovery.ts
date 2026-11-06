import type { Locale } from "@/i18n";

type Copy = { title: string; paragraphs: string[]; button: string };
export const confirmationRecoveryCopy: Record<Locale, Copy> = {
  pt: {
    title: "Confira seus dados para concluir a assinatura",
    paragraphs: [
      "Não conseguimos confirmar a correspondência entre o nome informado e o CPF deste cadastro. Isso pode acontecer por abreviações, erros de digitação, nomes fora de ordem ou diferenças no cadastro consultado.",
      "Confira seu nome completo e digite novamente o CPF informado no cadastro original. Corrija eventuais erros no nome e tente novamente.",
      "Também poderemos pedir sua data de nascimento ou o nome completo da sua mãe. Na confirmação pelo WhatsApp, essa conferência é sempre obrigatória.",
      "Seu cadastro será preservado enquanto você faz a correção. A assinatura só será concluída depois que os dados forem conferidos.",
      "Se os dados estiverem corretos e você ainda não conseguir continuar, entre em contato com a organização.",
    ],
    button: "Conferir dados e continuar",
  },
  en: {
    title: "Check your details to complete your signature",
    paragraphs: [
      "We could not confirm that the name entered matches the CPF in this registration. Abbreviations, typing errors, names in a different order or differences in the records consulted may cause this.",
      "Check your full name and re-enter the CPF used in the original registration. Correct any errors in your name and try again.",
      "We may also ask for your date of birth or your mother's full name. This check is always required when confirming through WhatsApp.",
      "Your registration will be preserved while you make the correction. Your signature will only be completed after your details have been checked.",
      "If your details are correct and you still cannot continue, contact the organizers.",
    ],
    button: "Check details and continue",
  },
  es: {
    title: "Revisa tus datos para completar la firma",
    paragraphs: [
      "No pudimos confirmar que el nombre informado corresponda al CPF de este registro. Puede deberse a abreviaturas, errores de escritura, nombres en distinto orden o diferencias en el registro consultado.",
      "Revisa tu nombre completo y vuelve a introducir el CPF del registro original. Corrige los posibles errores en el nombre e inténtalo de nuevo.",
      "También podremos solicitar tu fecha de nacimiento o el nombre completo de tu madre. Esta comprobación siempre es obligatoria al confirmar por WhatsApp.",
      "Tu registro se conservará mientras realizas la corrección. La firma solo se completará después de comprobar los datos.",
      "Si tus datos son correctos y aún no puedes continuar, contacta con la organización.",
    ],
    button: "Comprobar datos y continuar",
  },
  fr: {
    title: "Vérifiez vos données pour terminer votre signature",
    paragraphs: [
      "Nous n'avons pas pu confirmer la correspondance entre le nom saisi et le CPF de cette inscription. Des abréviations, fautes de frappe, noms dans un ordre différent ou différences dans le registre consulté peuvent en être la cause.",
      "Vérifiez votre nom complet et saisissez à nouveau le CPF utilisé lors de l'inscription initiale. Corrigez les éventuelles erreurs dans le nom et réessayez.",
      "Nous pourrons également demander votre date de naissance ou le nom complet de votre mère. Cette vérification est toujours obligatoire pour une confirmation par WhatsApp.",
      "Votre inscription sera conservée pendant la correction. Votre signature ne sera finalisée qu'après vérification des données.",
      "Si vos données sont correctes et que vous ne pouvez toujours pas continuer, contactez l'organisation.",
    ],
    button: "Vérifier les données et continuer",
  },
  de: {
    title: "Prüfen Sie Ihre Angaben, um die Unterschrift abzuschließen",
    paragraphs: [
      "Wir konnten nicht bestätigen, dass der angegebene Name zur CPF dieser Anmeldung passt. Gründe können Abkürzungen, Tippfehler, eine andere Namensreihenfolge oder Unterschiede im abgefragten Register sein.",
      "Prüfen Sie Ihren vollständigen Namen und geben Sie die CPF der ursprünglichen Anmeldung erneut ein. Korrigieren Sie mögliche Fehler im Namen und versuchen Sie es erneut.",
      "Wir können auch nach Ihrem Geburtsdatum oder dem vollständigen Namen Ihrer Mutter fragen. Bei einer Bestätigung über WhatsApp ist diese Prüfung immer erforderlich.",
      "Ihre Anmeldung bleibt während der Korrektur erhalten. Die Unterschrift wird erst nach Prüfung der Angaben abgeschlossen.",
      "Wenn Ihre Angaben korrekt sind und Sie trotzdem nicht fortfahren können, wenden Sie sich an die Organisation.",
    ],
    button: "Angaben prüfen und fortfahren",
  },
};
