# Verificar/Corrigir minha assinatura: alternativas de acesso seguro

**Pesquisa e proposta — 06/11/2026.** Solicitada pelo responsável pela plataforma e revisada em paralelo por um subagente. Este estudo não altera o aplicativo nem autoriza publicação. As escolhas de política, os textos e o escopo de implementação ainda precisam ser decididos.

## Recomendação

Disponibilizar um botão público **“Verificar/Corrigir minha assinatura”**. A entrada pode ser pública; a consulta privada e qualquer alteração exigem autenticação e autorização específicas para o registro.

Preferir **chave de acesso (passkey)** para edição, com verificação local por PIN ou biometria. Para cadastros antigos, oferecer uma migração pelo e-mail previamente confirmado, deixando explícito que esse primeiro vínculo herda a segurança daquele e-mail. Quando for necessário proteger também contra comprometimento/reutilização da caixa postal antiga, exigir outro autenticador já vinculado ou recuperação assistida.

CPF, nascimento e nome da mãe não autorizam a edição. Servem à comparação cadastral. Não há como criar retroativamente uma credencial forte que o usuário nunca cadastrou.

## O que a pesquisa encontrou

- **Livro:** Ross Anderson, *Security Engineering*, 3ª edição, capítulos 3 e 4. Recuperação e dados biográficos podem fragilizar a autenticação; usabilidade e vinculação correta das partes fazem parte da segurança do sistema. [Psicologia e usabilidade](https://www.cl.cam.ac.uk/archive/rja14/Papers/SEv3-ch03.pdf), [protocolos](https://www.cl.cam.ac.uk/archive/rja14/Papers/SEv3-ch04.pdf).
- **NIST SP 800-63B-4:** conhecimento biográfico não é um segredo apropriado de autenticação. O padrão distingue validação de e-mail/recuperação de autenticação out-of-band e não aceita e-mail como esse autenticador. Não apresentar login por e-mail como MFA/AAL2. [Autenticadores](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/).
- **FIDO:** passkeys permitem usar o desbloqueio do aparelho; a biometria permanece no dispositivo, não no site. [Explicação oficial](https://fidoalliance.org/passkeys/).
- **OWASP:** a recuperação mais fraca pode contornar uma passkey; a operação de vincular/remover credenciais também precisa de proteção. [Segurança de passkeys](https://cheatsheetseries.owasp.org/cheatsheets/Passkey_Security_Cheat_Sheet.html).
- **Estudo empírico:** *“We've Disabled MFA for You”* mostra recuperações de serviços que permitiram contornar MFA mediante acesso ao e-mail. [Artigo original](https://arxiv.org/abs/2306.09708).
- **Fórum técnico:** um implementador relatou links de uso único consumidos por scanners de e-mail antes do usuário. Há discussão de scanners que executam JavaScript. É evidência operacional, não uma norma ou garantia universal. [Relato original](https://security.stackexchange.com/questions/211258/do-mail-servers-follow-links-in-emails-as-part-of-a-security-scan-before-inbox-d/211277).

As referências orientam a proposta. Não representam uma certificação da plataforma nem demonstram que qualquer mecanismo isolado impeça todos os ataques.

## Alternativas e compromissos

| Alternativa | Vantagens | Desvantagens e limites | Adequação à plataforma |
|---|---|---|---|
| CPF + nascimento/mãe | Familiar; dados já usados na comparação | Podem ser conhecidos, vazados ou obtidos por terceiros; não demonstram controle do cadastro | Não usar como login ou recuperação que libera edição |
| Link ou código temporário no e-mail original | Sem senha nova; transição simples para a base existente | Depende da caixa postal; encaminhamento, phishing, acesso compartilhado e endereço reciclado são riscos | Opção de migração com risco explicitamente aceito, não substituto equivalente de passkey |
| Passkey com verificação do usuário | Uso rápido após cadastro; resistência a phishing; sem senha digitada no site | Exige primeiro vínculo e recuperação planejados; perda de dispositivos e proteção da conta de sincronização importam | Preferida para autorizar alterações |
| Senha + aplicativo autenticador | Modelo conhecido; não depende de e-mail em cada acesso | Mais etapas, esquecimento/reutilização de senha, suporte e recuperação; OTP digitável pode sofrer phishing | Alternativa possível, com maior fricção para uma petição |
| Código em WhatsApp/telefone previamente confirmado | Canal familiar; pode ser uma alternativa previamente vinculada | Custos e indisponibilidade; perda/reciclagem de número, invasão de conta e golpes de operadora | Não usar número recém-digitado para autorizar a troca; não chamar dois canais de MFA automaticamente |
| Código de recuperação previamente entregue | Pode funcionar sem e-mail/celular; reserva de acesso | Precisa ser guardado; quem obtiver o segredo pode usá-lo | Uso único, protegido no banco e sujeito a limites |
| Google/Microsoft por OIDC | Aproveita conta existente; pode reduzir digitação | Dependência e recuperação do provedor; vinculação incorreta pode dar acesso cruzado | Opcional; associar por identificador estável do provedor, sem fusão automática por e-mail |
| GOV.BR | Pode oferecer autenticação e identidade mais fortes | Integração depende de elegibilidade, credenciais e homologação | Avaliar separadamente; não presumir disponibilidade imediata para esta organização |
| Recuperação assistida | Resolve perda real de todos os meios anteriores | Mais lenta; atendimento também sofre engenharia social | Exceção documentada; não aceitar apenas conhecimento de CPF, filiação e nascimento |

TOTP, códigos por e-mail e passkeys não oferecem as mesmas propriedades. Passkeys precisam solicitar e conferir a verificação do usuário; presença/toque isolado não basta para assumir MFA. [OWASP — fatores e recuperação](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html), [W3C WebAuthn](https://www.w3.org/TR/webauthn-2/).

A integração GOV.BR não é automaticamente aberta a qualquer site privado. Os termos oficiais descrevem órgãos públicos e hipóteses de exceção; a elegibilidade desta plataforma deve ser confirmada antes de planejar dependência desse login. [Termos oficiais de integração](https://www.gov.br/governodigital/pt-br/estrategias-e-governanca-digital/transformacao-digital/ferramentas/autenticacao-gov.br/termo-de-uso-do-servico-de-integracao-com-a-conta-gov.br).

## Fluxo proposto

### 1. Entrada pública simples

O botão abre duas opções: **entrar com chave de acesso** ou **receber orientações pelo e-mail**. CPF pode ajudar a localizar internamente um registro, mas não deve funcionar como senha; não é necessário pedir nascimento ou mãe para abrir essa página.

Antes de autenticar, não mostrar nome, inscrição, situação da assinatura ou endereço mascarado de outra pessoa. A resposta ao pedido de acesso deve ser neutra e verdadeira, por exemplo: “Se houver cadastro compatível, enviaremos as orientações para o endereço já vinculado.” Não afirmar que uma mensagem foi enviada quando nenhum envio ocorreu. Aplicar limites e proteção contra bombardeio de e-mails. [OWASP — recuperação de acesso](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

Não enviar acesso para um novo endereço fornecido junto com o CPF. Primeiro é preciso comprovar o controle do canal anterior ou concluir a recuperação apropriada.

### 2. Acesso de quem já possui passkey

Autenticar com a credencial previamente vinculada e criar uma sessão curta, restrita à assinatura correspondente. Permitir consultar os próprios dados. Para editar nome, categoria, e-mail ou meios de recuperação, pedir autenticação recente e confirmar o resumo exato da mudança.

Não usar número de inscrição, QR, código público ou link de divulgação como credencial. A autenticação deve determinar no servidor qual registro pode ser acessado; um ID enviado pelo navegador não concede permissão.

### 3. Migração de cadastros antigos

O e-mail já confirmado é a ponte disponível na maioria dos registros antigos. Um link temporário pode abrir uma etapa limitada para conferir o cadastro e vincular uma passkey. Isso protege contra quem sabe apenas dados pessoais, mas não contra alguém que já controla aquela caixa postal.

É necessária uma escolha explícita:

- **Política equilibrada:** aceitar esse primeiro vínculo pelo e-mail original, registrar o evento e notificar o titular; diante de risco, exigir reforço ou atendimento. É mais simples, mas assume a confiança herdada do e-mail.
- **Política mais forte:** antes de liberar alterações sensíveis, exigir também outro meio previamente vinculado ou recuperação assistida. Mais proteção, com uma etapa adicional nos casos antigos.

Uma espera após recuperação pode permitir detectar fraude, mas não comprova titularidade. Não prometer proteção contra caixa postal comprometida apenas porque houve espera ou conferência de nascimento.

### 4. Recuperação sem enfraquecer a conta

Após vincular uma passkey, o caminho “perdi acesso” não deve liberar as mesmas alterações usando somente CPF ou um e-mail. Priorizar outra passkey já cadastrada, segredo de recuperação previamente guardado ou processo de recuperação proporcional ao risco. Notificar o titular e revisar/revogar sessões e credenciais quando necessário. [NIST — recuperação e ciclo de vida](https://pages.nist.gov/800-63-4/sp800-63b/events/).

Dois links recebidos na mesma caixa postal não são dois fatores independentes. Um telefone informado durante a recuperação ainda não é um canal confiável. Atendimento convincente e dados biográficos corretos também não bastam.

### 5. Alteração de e-mail

Manter o novo endereço como mudança pendente. Exigir reautenticação, confirmar o endereço novo e notificar o antigo. Quando o fluxo depender somente de e-mails, avaliar confirmação em ambos; se o antigo estiver inacessível, seguir a recuperação apropriada, sem substituição imediata por CPF/dados pessoais. [OWASP — verificação e troca de e-mail](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

E-mail institucional pode ser desativado ou atribuído a outra pessoa. Por isso, conhecimento do endereço antigo e acesso atual àquela caixa não comprovam automaticamente a titularidade histórica da assinatura.

### 6. Alteração dos dados da assinatura

Depois da autenticação, aplicar a regra de validação de nome/CPF aos dados novos. Preservar o mesmo ID, inscrição, CPF em hash, data de criação e confirmação original. Registrar versões com antes/depois, horário da correção e método de autorização. Não transformar uma correção em uma nova assinatura.

O servidor precisa vincular a autorização à ação e aos valores apresentados. Uma autorização para corrigir campus não pode trocar e-mail ou registrar outra passkey; mudar os valores invalida a autorização da operação anterior. [OWASP — autorização de operações](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

Apoiador que é servidor pode solicitar a correção de categoria e informar os dados profissionais. A política pode admitir e-mail pessoal confirmado quando o institucional falhar, mas deve distinguir **categoria declarada**, **identidade conferida** e **vínculo institucional verificado**. Conferir CPF não comprova emprego público.

Não reescrever documentos já assinados/enviados. A correção deve gerar a versão documental aplicável, mantendo trilha e datas históricas.

## Relação com o código atual

- `site/src/lib/referrals.ts` e `site/src/app/meu/[token]/page.tsx`: painel de cartaz/indicações por token de posse. Não é uma autorização completa para edição nem uma sessão com reautenticação. Não ampliar seus privilégios automaticamente.
- `site/src/lib/signatures.ts`: a duplicidade confirmada bloqueia a criação, mas retorna sem resultado explícito. O frontend anuncia envio indevido. Resolver o contrato e a mensagem junto com a política de privacidade do acesso.
- `site/src/lib/assinaturas-email.ts`: correção administrativa de e-mail hoje é limitada a pendentes. Não equivale ao autosserviço autenticado para registros confirmados.
- `site/src/lib/confirmation-check.ts` e `ConfirmationRecovery.tsx`: trabalho em desenvolvimento para concluir/corrigir pendentes. Um link de confirmação válido tem escopo diferente da edição posterior de uma assinatura confirmada. As novas decisões de autenticação precisam ser incorporadas antes de ampliar esse escopo.
- `site/src/lib/email-check.ts`: a chave de deduplicação não é necessariamente o endereço de entrega. Rever `+etiqueta` fora de provedores confirmados e planejar migração compatível; não alterar hashes em massa sem análise.

## Controles e parâmetros de implementação propostos

Usar biblioteca WebAuthn mantida; verificar challenge, origem permitida, RP ID, assinatura e verificação do usuário no servidor. Separar desafios de cadastro, login e autorização de mudanças. Não escrever protocolo criptográfico próprio.

Tokens aleatórios devem ter propósito e destinatário vinculados, validade curta e consumo único; guardar somente forma protegida no servidor. Uma página aberta por GET não altera o cadastro nem consome autorização de edição. Ação explícita e contexto do pedido evitam depender apenas de um POST automático que scanners também podem executar.

Sessões precisam de cookies `Secure`, `HttpOnly`, `SameSite`, proteção CSRF, autorização por registro e revogação. Remover segredos de URL após o uso e evitar tokens em logs, analytics, referrers e cache compartilhado. Registrar eventos de segurança sem armazenar códigos, respostas completas de autenticação ou biometria.

Exemplos de parâmetros para decidir em implementação: link de dez minutos; sessão de consulta de quinze a trinta minutos; reautenticação recente para escrita; eventual espera em recuperações de maior risco. **São propostas de projeto, não prazos universais impostos pelas fontes.**

Não bloquear permanentemente uma assinatura confirmada porque um visitante anônimo tentou acessar o CPF. Aplicar limites sem criar um meio trivial de impedir o titular de consultar seu registro.

## Limite da garantia

Uma autenticação protege o controle de uma conta previamente vinculada. Ela não demonstra, por si só, que a assinatura inicial foi feita pelo titular civil verdadeiro do CPF. A API cadastral também não prova posse do documento nem manifestação de vontade.

Nenhuma alternativa garante imunidade a aparelho, caixa postal, administrador ou infraestrutura comprometidos. A proposta impede que **apenas conhecer CPF e dados pessoais** dê direito de edição e reduz os demais riscos por autenticação, recuperação, autorização e histórico.

## Testes cumulativos exigidos antes de publicar

- Reexecutar validação de nomes, cache de 30 dias, limite de tentativas, pendentes, estrangeiros, e-mail e WhatsApp.
- Duplicidade entre categorias: nenhuma nova assinatura, mudança silenciosa ou falso aviso de envio.
- Pessoa sem acesso ao e-mail/credencial não consulta nem altera dados privados apenas com CPF/DOB/mãe.
- Registro de passkey vinculado à conta correta; rejeitar origem, challenge, usuário ou assinatura incorretos.
- Token expirado, reutilizado, de outro propósito ou de outro registro não concede sessão nem autoriza mudança.
- Leitura de link por scanner não confirma assinatura, consome edição ou muda dados.
- Tentativa de trocar e-mail/credenciais por recuperação fraca não contorna a passkey.
- Alterações concorrentes não aplicam uma autorização obtida para valores antigos.
- Correção preserva ID, inscrição, hash do CPF e datas; histórico conserva o estado anterior.
- Fluxos novos não alteram as decisões da revisão local; o receptor continua estritamente VPS → SQLite.

## Decisões ainda necessárias

1. Aceitar migração inicial pelo e-mail confirmado ou exigir reforço para alterações sensíveis no legado.
2. Definir a recuperação para quem perdeu todos os meios anteriores e o procedimento contra engenharia social.
3. Definir quais mudanças são imediatas e quais exigem confirmação adicional.
4. Aprovar textos e política para e-mail pessoal em correção de apoiador para servidor.
5. Escolher retenção e acesso ao histórico de segurança, incluindo a proposta separada de rascunhos parciais.

Os problemas relacionados estão em [Histórico de problemas](../HISTORICO-DE-PROBLEMAS.md). Nenhuma dessas decisões foi presumida aprovada pela elaboração deste estudo.
