# Política central de e-mail do formulário Servidor(a)

Versão: `2026-11-08.approved-ifes-only-v1`. Aprovada pelo proprietário em08/11/2026
para próximos cadastros. Implementação em candidato isolado; ainda não publicada.

Somente domínio classificado como `ifes`, aprovado na curadoria ou na semente
oficial de IFES, habilita novos pedidos como Servidor(a). Subdomínios herdam a
aprovação quando aplicável; rejeições específicas e regras de domínio discente
continuam prevalecendo. Não basta ter .edu.br, .gov.br, .leg.br, .jus.br, .mp.br,
ser órgão federal/estadual/municipal ou ter aprovação genérica `outro`.

O endpoint do campo e o processamento do cadastro usam a mesma função central
`acceptsServerDomain`. Chamada direta à API não contorna a regra. Sugestões do
backend para Servidor usam apenas a lista aprovada de IFES. Outros domínios podem
seguir como Apoiador(a), sujeitos às validações desse fluxo; o novo enquadramento
não dispensa CPF, correspondência do nome, nascimento/mãe, consentimento ou limites.

Ao clicar Assinar, e-mail não elegível gera uma única janela de aviso e mantém o
campo vermelho e os dados digitados. Ao sair do campo, permanece apenas o aviso
inline já existente, sem modal. Não modificar fontes, dimensões ou layout.

Textos aprovados para campo/modal, com traduções equivalentes:

- “Servidor(a): use o e-mail institucional de uma universidade federal ou instituto federal. Para outros e-mails, assine como Apoiador(a).”
- “Este e-mail é de uma instituição federal de ensino: assine pelo formulário de Servidor(a).”

Não há migração/reclassificação/exclusão de assinaturas existentes, mudança de
hashes/IDs/datas ou aprovação automática de domínios. Decisões de revisão de CPF
não são promovidas para produção. O domínio sou.ucpel.edu.br não é de IFES e não
foi aprovado; ufpel.edu.br pertence à Universidade Federal de Pelotas.

## Domínios reconhecidos no Apoiador

A pedido do proprietário em08/11/2026, `ucpel.edu.br` e `sou.ucpel.edu.br` constam
explicitamente em `SUPPORTER_KNOWN_DOMAINS`. O reconhecimento evita sugerir troca
por outra universidade quando o endereço está correto. Não é aprovação IFES nem
exceção a sintaxe, MX, consentimento, CPF, identidade, duplicidade ou antirrobô.
Não altera a curadoria da VPS e não libera esses domínios no formulário Servidor.
