# Validação da recuperação antirobô e regra IFES

Candidato: `/mnt/dev/peticao/.cache/signup-honeypot-20261108/candidate`.
Branch: `signup-honeypot-recovery-20261108`. Base61edd21; plano bb76241;
implementação f4f3528. Nenhum deploy, merge com VPS ou alteração em produção.

## Decisões e resultado

Alternativa2 autorizada: campo oculto é sinal auxiliar, exige Turnstile válido ou
prova assinada da etapa anterior; nunca retorna sucesso apenas para descartar uma
pessoa por esse campo. Erros de segurança mantêm os campos e permitem nova tentativa.
A prova fica limitada ao ticket de15min e ao nome/e-mail/CPF/categoria validados;
não guarda nascimento, mãe, CPF aberto ou dados adicionais em tabela. O token do
Turnstile é consumido uma vez; a prova no ticket também atende abas já abertas que
não conhecem a nova propriedade JSON. Assinaturas/identidade/duplicidade e limites
continuam necessários.

Somente IFES aprovadas habilitam próximos cadastros Servidor. Domínios de outros
órgãos públicos, genéricos edu.br ou aprovados como outro/federal não bastam.
Validação do campo e API de cadastro usam a função central. E-mail não elegível
abre uma única janela ao clicar Assinar, com borda/aviso vermelhos; blur não abre
modal. Apoiador mantém validação de CPF/identidade. Textos aprovados aplicados em
cinco idiomas, sem alterar CSS, fontes, dimensões, avisos de privacidade ou outros
textos. Nenhuma reclassificação/migração de assinaturas existentes foi executada.

## Evidências executadas

- Direcionados:29/29, incluindo código por categoria, assinatura/prova, dados
  preservados, desafio indisponível/desativado/reutilizado e recusa de domínio
  não federal. A última cumulativa inclui as asserções adicionais para abas antigas.
- Cumulativa definitiva:194/194, zero falhas/ignorados, código0, arquivos em série
  e concorrências internas preservadas. Duração354142ms no ambiente sob carga.
- Build de produção e tipos aprovados após implementar a compatibilidade do ticket.
- Navegador mobile390px, backend compilado real, PostgreSQL exclusivo54351 e
  provedores fictícios: quatro cenários aprovados, sem erros JavaScript:
  1. UCPel: erro inline no blur, um modal ao enviar, campo vermelho, zero POST de cadastro.
  2. Servidor: campus errado, correção e sucesso preservando demais campos.
  3. Apoiador: segurança recusada preserva dados; nova tentativa/identidade conclui.
  4. Estrangeiro: erro de segurança preserva país/universidade e permite nova tentativa.
- Snapshot em banco fictício confirma preservação de registros históricos e
  decisões aprovadas de curadoria durante recusas. Nenhuma consulta CPF real,
  envio externo ou cobrança de API foi realizada.

Artefatos privados: `/home/barre/.cache/peticao-honeypot-qa-20261108/`, incluindo
`all-final.log`, `build.log`, `browser-results.json`, `ucpel-modal-390.png` e logs
anteriores. Não versionar bancos, imagens com dados reais ou configuração runtime.
O navegador simula Turnstile/DNS/CPF; não é prova da disponibilidade dos serviços
externos. Servidor/DB de QA foram encerrados; prévia3031 e VPS preservadas.

## Falhas do ensaio, preservadas

Primeiro direcionado23/24: fixture de domínio estava com campus/declaração inválidos;
foi corrigido para alcançar a regra de e-mail, sem afrouxar a validação. Cumulativa
preliminar185/192: runner forçava PREVIEW_MODE e MAIL_PROVIDERS, interferindo nos
ensaios de produção simulada/transporte. Removidas apenas as imposições do runner;
nenhuma guarda enfraquecida. Nova cumulativa194/194 e repetição definitiva194/194.
Um ensaio visual esperava um tom de vermelho diferente do existente; o teste passou
a comparar com a variável CSS de erro, sem alterar a interface. Novo ensaio4/4.

## Publicação pendente

Publicar somente após autorização. Empacotar frontend/backend juntos a partir do
candidato validado e comparar novamente com a produção antes da publicação. Não
publicar integralmente o checkout principal ou o admin-v2. O admin-v2 deve incorporar
este checkpoint local em etapa própria e repetir seus testes antes da entrega.
