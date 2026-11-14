# Encerramento estrito da lease493 — somente metadados

Proposta para revisão nova de Root e Apoio. Infra não executa dry-run real,
apply, SSH ou outro comando de produção. Os testes usam banco temporário com
dados fictícios. Não é retry de deploy, renovação, aquisição ou reativação.

UUID a57c97c38267485a9ad5f0355f277c83, fence493, Root, operação R1, manifestoA761,
imagem5a582 e expiração1794662544.4754376 são fixos. A única alteração permitida
é state=uncertain para reconciled nessa linha, acompanhada de UM evento novo
r1_lease493_reconciled_scoped. Não cria resolution_confirmed ou alegação de quorum
ALL; atores, ACKs, notices, resoluções, observações e todas as outras leases são
comparados antes/depois, na mesma transação. Token, recursos, expiração e demais
colunas da493 também permanecem idênticos. Triggers com efeitos extras abortam.

Dois pareceres NOVOS precisam de actor (admin-recuperacao ou apoio), decision=pass,
purpose=r1-close-lease493 e binding exatamente igual ao binding congelado da
proposta. Reviews/ACKs R1 anteriores não qualificam a reconciliação. Não se trata
de nova autorização do proprietário: é conferência técnica específica do
encerramento que já faz parte do trabalho autorizado. Identidades permanecem
cooperativas, como no ledger; o operador deve conferir origem real e SHA das
attestações recebidas por cada agente, sem fabricar arquivos em nome de pares.

O binding fixa hash deste helper, post-proof original, observação Root recente,
prova HTTP/config e os três journals completos. As três etapas e post-proof
devem estar antes da expiração original; ordenação e fence são verificadas. A
observação runtime e o HTTP/config precisam de idade máxima900s no momento da
aplicação, ausência de execução/dispatch/intent, esquema/imagem/source e quatro
rotas exatas saudáveis. A prova Root é observação dele: Apoio/Infra conferem seus
recibos, sem alegar SSH independente. Se ficar antiga, Root deverá captar nova
prova somente leitura em escopo próprio livre e obter attestações atualizadas
para o novo binding; não sobrescrever prova congelada ou fingir frescor.

Root monta CLOSE-BINDING.json com binding da proposta e attestations como mapa
actor para path/sha256 do parecer real correspondente. O programa lê a capability
493 apenas de seu caminho privado original Root e compara identidade/token
localmente; não copia nem imprime o segredo, não o usa em produção ou renovação.
Root-only por CODEX_THREAD_ID e identidade registrada; recusa mudanças de atores.

O padrão é somente leitura e não cria intent. --apply existe para Root executar
após reviews próprios e prova ainda recente; Infra não o executa. Antes do UPDATE,
grava intent exclusivo/durável e revalida dentro de BEGIN IMMEDIATE. Timeout,
falha ou intent existente exigem reconciliação, sem apagar intent ou retry cego.
Um apply concluído mantém o intent como marcador de uso único e retorna seq do
evento de auditoria; o ledger é o recibo autoritativo. Não repetir para transformar
um evento scoped em confirmação global. A migração continua aguardando Root
confirmar encerramento e liberação, não apenas existir código de reconciliação.
