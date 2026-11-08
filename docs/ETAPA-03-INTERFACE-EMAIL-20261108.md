# Controles reais de e-mail e integração dos incrementos

AV9/10/11/12 aprovados. `a4cde34` conectou a recuperação e a prévia ao painel,
usando os mesmos tokens/componentes visuais. Total real e confirmação extra são
exigidos; os endpoints mantêm suas próprias guardas. A prévia só é buscada após
clique e usa iframe com sandbox vazio, no-referrer e conteúdo transformado pelo
backend. Conteúdo bruto/anexos/códigos não são oferecidos como download.

Recuperação mostra somente candidatos com prova de aceite e conserva as mensagens.
Resposta perdida depois do commit provoca consulta de estado, sem repetir POST.
Não há transporte, alteração de assinatura ou reconstrução de conteúdo vencido.

## Validação efetiva

Build integrado1 terminou0. Manifesto de fonte antes/depois idêntico. Em
`/tmp/admin-consolidation-k2jdskrz/`, contratos compilados mail-recovery,
mail-preview e contact-drafts terminaram0, em banco fictício54349/HTTP3033.
Recuperação real foi exercitada390/1440px, incluindo cancelar e perder a resposta
após commit. Prévia/editor usaram320/390/768/992/1280/1920px. Originais, assinantes
e tentativas conservados; iframe sem scripts/rede/acesso ao pai. Capturas390 foram
inspecionadas pelo principal. Isso substitui o ensaio antigo que montava iframe
manualmente: agora os botões e componentes vêm da página compilada real.

Build integrado2 terminou0; tipos0 e manifesto sem alterações durante a janela.
Logs em `/home/barre/.local/state/peticao-admin-recovery/build-window-20261108T2343/`.
Em `/tmp/admin-consolidation-1m8mtcab/`, nova rodada terminou0:

- mail-preview: seis larguras, botão Fechar alcançável sem rolar a prévia e
  fechamento efetivo; isolamento e máscara continuam verificados.
- contact-drafts: complemento de cifra indisponível preserva conteúdo, bloqueia
  sobrescrita e permite consultar novamente; provas do agente no relatório próprio.
- admin-password-ui: formulários reais rejeitam7 antes do POST, aceitam8 na troca
  e redefinição, revogam ambas as sessões antigas e preservam o mecanismo de hash.
  Nenhum transporte ou escrita de assinatura nesse contrato.

## Limites e próximos itens

O ramo de Central na primeira rodada do build2 falhou por cota real compartilhada
429. O agente reproduziu, preservou a evidência e repetiu com cadência normal;
não houve redução da guarda. Sua prova é separada e não foi incluída como sucesso
em uma execução que falhou. Paginação nova do Contato e outras fontes posteriores
precisam do próximo build. O histórico de tentativas/eventos ainda precisa de
interface detalhada; a tabela de prévia não conclui toda a Central de E-mails.

Os545 testes de `c975304` pertencem ao snapshot anterior, não a esses incrementos.
O aceite final exigirá um novo commit fechado com todos os módulos. Nenhum deploy,
merge com VPS, envio real ou alteração do formulário público foi realizado.
