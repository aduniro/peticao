import { isValidCpf, onlyDigits } from "./cpf";

/** Shared public-form policy: incomplete CPF is quiet while editing, invalid full CPF is not. */
export function showCpfError(value: string, blurred: boolean): boolean {
  return (blurred || onlyDigits(value).length === 11) && !isValidCpf(value);
}
