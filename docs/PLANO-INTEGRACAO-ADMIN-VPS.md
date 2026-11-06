# Integração admin-v2 e versão atual da VPS

Plano solicitado e considerado aprovado pelo responsável após sua apresentação em
06/11/2026. **Aprovação das etapas não autoriza o deploy final.**

## Objetivo integral

Integrar o admin-v2 local ao backend atual da VPS; concluir os trabalhos incompletos
da proposta e do histórico, padronizar as telas pelo visual atual do admin-v2,
validar o conjunto cumulativamente e aguardar autorização para deploy.

## Etapas

1. Checkpoint Git e inventário das versões, sem modificar produção, segredos ou
   decisões locais de CPF/nome.
2. Ler proposta, histórico e implementação; criar matriz verificável de todos os
   requisitos, inclusive módulos incompletos do agente anterior.
3. Merge em checkout separado, tomando a produção efetiva como referência e
   preservando os fluxos atuais de CPF/cache/confirmação/e-mail/WhatsApp.
4. Uniformizar todas as telas do painel, permissões, navegação, mapas e tabelas,
   seguindo os tokens, componentes e estética atuais do admin-v2 no desktop/celular.
5. Concluir contatos/base de comunicação, conhecimento/assistentes, divulgação e
   aprovação do presidente previstos na proposta. Serviços sem credenciais ficam
   desligados; nenhuma guarda de assinatura/envio será removida.
6. Conferir contratos API e estados cadastrais; preservar IDs/datas/hashes/histórico
   e a independência da revisão local, sem promover decisões para a VPS sozinhas.
7. Verificações curtas por etapa e, ao final, testes cumulativos, tipos, build e QA
   de navegador nos fluxos/telas afetados.
8. Entregar candidato identificável por commit/manifesto, instruções de publicação
   e reversão; aguardar autorização de deploy.

## Evidência inicial, verificada agora

- Local: `/mnt/dev/peticao`, checkpoint `51ddf3e`; admin-v2 e alterações recentes
  de validação estão no checkout local.
- `/mnt/dev/peticao-parcial`: commit `9784afe`, sem as alterações posteriores.
- VPS: `/opt/peticao/app` e `/home/adunir/peticao-stage/site` têm o mesmo inventário
  inicial de código. O stage atual não é uma cópia dev isolada com o admin novo.
- `/home/adunir/peticao` não existe. Node da VPS: `v20.19.2`.
- Comparação inicial encontrou 75 arquivos existentes da produção diferentes no
  checkout local; a contagem não inclui todos os arquivos novos do painel.
- Capturas de fonte excluem `.env`, credenciais, bancos, runtime e dependências.
  Inventários e snapshots de trabalho ficam em `.cache/admin-integration/`.

## Regras de execução

Commits antes/depois e por etapa. Nenhum envio de e-mail/WhatsApp, publicação,
ativação de provedor ou escrita no banco de produção nesta integração. Preservar
os avisos públicos existentes e as decisões da revisão. Mudanças necessárias em
avisos não aprovados ficam propostas para revisão, sem aplicação silenciosa.

A conclusão depende da matriz de requisitos e de evidências atuais de execução;
testes anteriores são pontos de partida, não prova automática de integração.
