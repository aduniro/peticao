import test from "node:test";
import assert from "node:assert/strict";
import { detalheDeSugestao, diagnosticar, distancia } from "./email-diagnostico";

const dx = (e: string, known: string[] = []) => diagnosticar(e, known);

test("distância conta a troca de letras vizinhas como 1 erro", () => {
  assert.equal(distancia("gmial.com", "gmail.com"), 1);
  assert.equal(distancia("gmail.con", "gmail.com"), 1);
  assert.equal(distancia("gmail.com", "gmail.com"), 0);
  assert.equal(distancia("abc", "xyz"), 3);
});

test("provedor aberto digitado errado: bloqueia e diz o que está errado, o correto e como digitar", () => {
  for (const [digitado, certo] of [["gmail.con", "gmail.com"], ["gmial.com", "gmail.com"], ["gmai.com", "gmail.com"], ["gnail.com", "gmail.com"], ["hotmial.com", "hotmail.com"], ["outlok.com", "outlook.com"], ["yaho.com.br", "yahoo.com.br"], ["gmail.co", "gmail.com"]]) {
    const d = dx(`fulano@${digitado}`)!;
    assert.ok(d, digitado);
    assert.equal(d.problema, "provedor", digitado);
    assert.equal(d.errado, digitado);
    assert.equal(d.correto, certo, digitado);
    assert.equal(d.sugestao, `fulano@${certo}`);
    assert.equal(d.exemplo, `fulano@${certo}`);
    assert.equal(d.bloqueia, true);
  }
});

test("mesmo provedor com final diferente (gmail.com.br, hotmail.fr): só sugere; o servidor decide pelo MX", () => {
  for (const digitado of ["gmail.com.br", "hotmail.fr", "outlook.es"]) {
    const d = dx(`x@${digitado}`)!;
    assert.equal(d.problema, "final", digitado);
    assert.equal(d.bloqueia, false, digitado);
  }
  assert.equal(dx("x@gmail.com.br")!.correto, "gmail.com");
});

test("erros de estrutura: sem @, dois @, espaço, vírgula, domínio incompleto", () => {
  assert.deepEqual(dx("fulanogmail.com"), { problema: "sem_arroba", errado: "fulanogmail.com", correto: "gmail.com", sugestao: "fulano@gmail.com", exemplo: "fulano@gmail.com", bloqueia: true });
  assert.equal(dx("fulano.gmail.com")!.sugestao, "fulano@gmail.com");
  assert.equal(dx("semarrobaaqui")!.problema, "sem_arroba");
  assert.equal(dx("a@b@gmail.com")!.problema, "varios_arrobas");
  assert.equal(dx("fulano @gmail.com")!.problema, "espaco");
  assert.equal(dx("fulano @gmail.com")!.sugestao, "fulano@gmail.com");
  assert.deepEqual(dx("fulano@gmail,com"), { problema: "virgula", errado: "gmail,com", correto: "gmail.com", sugestao: "fulano@gmail.com", exemplo: "fulano@gmail.com", bloqueia: true });
  assert.deepEqual(dx("fulano@gmail"), { problema: "sem_final", errado: "gmail", correto: "gmail.com", sugestao: "fulano@gmail.com", exemplo: "fulano@gmail.com", bloqueia: true });
  assert.equal(dx("fulano@gmail.")!.correto, "gmail");
});

test("domínios certos e legítimos nunca são tratados como erro", () => {
  for (const ok of ["x@gmail.com", "x@hotmail.com", "x@outlook.com.br", "x@uol.com.br", "x@mail.com", "x@email.com", "x@live.com", "x@unir.br", "x@empresa-qualquer-xyz.com.br"]) assert.equal(dx(ok), null, ok);
  assert.equal(dx(""), null);
  assert.equal(dx("   "), null);
});

test("IFC: ifc.edu.br está na lista e erros parecidos sugerem o endereço certo", () => {
  assert.equal(dx("x@ifc.edu.br"), null);
  for (const errado of ["ifc.edu.bt", "ifc.edu.com", "ifc.com.br", "ifc.edu.b"]) {
    const d = dx(`x@${errado}`)!;
    assert.ok(d, errado);
    assert.equal(d.problema, "parecido", errado);
    assert.equal(d.correto, "ifc.edu.br", errado);
    assert.equal(d.sugestao, "x@ifc.edu.br");
    assert.equal(d.bloqueia, false);
  }
});

test("domínios do banco (informados em known, inclusive os inseridos à mão) entram nas sugestões", () => {
  const known = ["meudominio.org", "outra-faculdade.edu.br"];
  assert.equal(dx("x@meudominio.org", known), null);
  assert.equal(dx("x@meudominoi.org", known)!.correto, "meudominio.org");
  assert.equal(dx("x@outra-faculdade.edu.bt", known)!.correto, "outra-faculdade.edu.br");
  assert.equal(dx("x@meudominoi.org"), null); // sem o banco, não há o que sugerir
});

test("redes sociais e encurtadores são válidos mas nunca viram sugestão", () => {
  assert.equal(dx("x@twitter.com"), null);
  assert.equal(dx("x@twiter.com"), null);
  assert.equal(dx("x@bit.ly"), null);
});

test("detalheDeSugestao: descreve uma sugestão calculada por outro caminho", () => {
  assert.deepEqual(detalheDeSugestao("maria@ufpel.edu.gov", "maria@ufpel.edu.br"), { problema: "parecido", errado: "ufpel.edu.gov", correto: "ufpel.edu.br", sugestao: "maria@ufpel.edu.br", exemplo: "maria@ufpel.edu.br", bloqueia: false });
  assert.equal(detalheDeSugestao("maria@gmial.com", "maria@gmail.com")!.problema, "provedor");
  assert.equal(detalheDeSugestao("maria@gmail.com", "maria@gmail.com"), null);
  assert.equal(detalheDeSugestao("sem-arroba", "x@y.com"), null);
});
