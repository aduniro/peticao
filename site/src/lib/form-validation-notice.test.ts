import test from "node:test";
import assert from "node:assert/strict";
import { formValidationNotice } from "./form-validation-notice";

const copy = {
  nameMismatch: "Confira a grafia e informe o seu nome completo.",
  validationText: (details: string) => `Revise os campos em vermelho: ${details}`,
};

test("aviso de nome usa a mensagem curta aprovada e botão Corrigir", () => {
  assert.deepEqual(formValidationNotice({ name: "name_cpf_mismatch" }, copy, (code) => code), {
    titleKey: "name.validationTitle",
    text: "Confira a grafia e informe o seu nome completo.",
    buttonKey: "name.correct",
  });
});

test("vários campos produzem uma única mensagem com os erros de nome e e-mail", () => {
  assert.deepEqual(formValidationNotice({ name: "name_cpf_mismatch", email: "email_invalid" }, copy, (code) => `Mensagem ${code}`), {
    titleKey: "field.validationTitle",
    text: "Revise os campos em vermelho: Confira a grafia e informe o seu nome completo. Mensagem email_invalid",
    buttonKey: "field.correct",
  });
});

test("erro da declaração regional é descrito no único modal", () => {
  assert.equal(formValidationNotice({ region: "region_required" }, copy, (code) => "Marque a caixa da Amazônia Legal ou Faixa de Fronteira.").text,
    "Revise os campos em vermelho: Marque a caixa da Amazônia Legal ou Faixa de Fronteira.");
});
