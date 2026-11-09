/** Proposed neutral copy only. This directory is OFF and has no route/import in the app. */
export type PresidentDraftCopy = {
  title: string; password: string; cpf: string; birthDate: string; confirm: string;
  viewDocument: string; downloadDocument: string; document: string; confirmed: string; unavailable: string; uncertain: string;
  checkState: string; invalidCpf: string; invalidFields: string;
};
export const proposedPresidentCopy: PresidentDraftCopy = {
  title: "Confirmar documento", password: "Senha de uso único", cpf: "CPF", birthDate: "Data de nascimento", confirm: "Confirmar",
  viewDocument: "Visualizar documento", downloadDocument: "Baixar PDF", document: "Documento", confirmed: "Confirmação registrada.",
  unavailable: "Este link não está disponível. Solicite um novo link.",
  uncertain: "Resultado a conferir. Consulte o estado antes de tentar novamente.", checkState: "Consultar estado",
  invalidCpf: "CPF inválido.", invalidFields: "Verifique os campos destacados.",
};

/** Additional neutral admin labels still requiring review, not activated. */
export const proposedIssueCopy = {
  generate: "Gerar link de confirmação", generateNew: "Gerar novo link", link: "Link de confirmação", password: "Senha de uso único", expires: "Válido até", copyLink: "Copiar link", copyPassword: "Copiar senha",
  rejected: "Não foi possível gerar o link.", uncertain: "Resultado a conferir.",
};
