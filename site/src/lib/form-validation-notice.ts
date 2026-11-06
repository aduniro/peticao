export type FormValidationNotice = { titleKey: string; text: string; buttonKey: string };

/** Gera um único aviso claro para qualquer conjunto de erros de campo. */
export function formValidationNotice(
  errors: Record<string, string>,
  copy: { nameMismatch: string; validationText: (details: string) => string },
  translateError: (code: string) => string,
): FormValidationNotice {
  const entries = Object.entries(errors);
  const onlyNameMismatch = entries.length === 1 && entries[0][0] === "name" && entries[0][1] === "name_cpf_mismatch";
  if (onlyNameMismatch) return { titleKey: "name.validationTitle", text: copy.nameMismatch, buttonKey: "name.correct" };

  const details = entries.map(([key, code]) => key === "name" && code === "name_cpf_mismatch" ? copy.nameMismatch : translateError(code));
  return {
    titleKey: "field.validationTitle",
    text: copy.validationText(details.join(" ")),
    buttonKey: "field.correct",
  };
}
