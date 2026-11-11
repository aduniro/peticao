# Materiais — bateria PG17 isolada preparada, NÃO EXECUTADA

Arquivo: /mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/site/src/lib/materials-store.pg.test.ts
Base backend: c02bfaca9def79d01d02ada4bbd5c9738bf443b9, f555 cumulativo. Contrato/schema/store/rotas existentes não foram editados. NenhumPG/aplicativo/build/instalação/merge/deploy foi executado.

## O que os nove callbacks deverão provar

1. DDL aditivo aplicado primeiro no setup e novamente APÓS criação real, preservando todos registros; JSONB/hash/autoria/head e recusa deFKhead estrangeira noCOMMIT.
2. Dois atores disputando expectedRevision1: um vencedor,umconflict, exatamente uma revisão/audit/recibo novos.
3. Mesmoator+requestId em duas sessões: commitúnico/replay; payloaddistinto→request_conflict; depoisdeoutrarevisão,replay/GET retornam versãooriginalsemseapresentarcomoheadatual; outroator não recupera recibo, mas pode usar mesmoUUID emscopepróprio.
4. Triggerfixture de auditoria falhando reverte createerevise inteiros: nenhumhead/versão/recibo órfão,nemalteração dosregistrosanteriores. SequênciasPG podem consumirnúmeros no rollback e não são alegadasimutáveis.
5. Leitor não escreve; sessão pertencenteaoutroator/emailforjado/atornulo são recusados; rebaixamento,desativação,trocarsenha,expiração e exclusãodesessão impedem admissão.
6. Archive apendav2preservandov1; UPDATE/DELETE versões/recibos e DELETEhead recusados; arquivado não é restaurado. Não promete proteção contraTRUNCATE/superuserSQL.
7. Biblioteca com52materiais e1arquivado:51ativos em páginas50+1, UUIDdescsemrepetição; arquivadosseparados e consultasnãomudamregistros.
8. Histórico com51revisões: páginas50+1/ordinais51..1, head51preservado.
9. Featureflagdesligada recusaquatroentrypoints e preserva dados.

Ao completar cada callback deverá também conferir cadeiaauditreal e zeros nas tabelas mail/attempts/outbox/envios/batches/signatures. Tudo éconteúdofictício deMateriais, semPFX/assinatura/provedores/contatos/IA.

## Admissão fechada da fixture

Default: sem MATERIALS_PG_FIXTURE exato, os9callbacks ficam SKIP e nãoimportam pg/db/store. Para execução REAL futura, wrapperisolado deverá fornecer SOMENTE osambientesfictícios: MATERIALS_PG_FIXTURE=materials-library-pg17-isolated-v1; DATABASE_URL=postgres://fixture_only:fixture_only@127.0.0.1:55496/fixture_only; MATERIALS_PG_FIXTURE_NONCE com12hex aleatórios iguais acluster_name; NODE_ENV=test; MAIL_PROVIDER=dev eMAIL_PROVIDERS=dev; MATERIALS_LIBRARY_ENABLED=1; APPROVER_EMAIL eRECIPIENTSvazios; SIGNER=none; DATABASE_SCHEMAausente eprocessosempoolherdado.

AntesdequalquerDDL, verificaserver_version_num170011/currentdatabasefixture_only/currentuserfixture_only/cluster_namenonce/data_directory/var/lib/postgresql/data viaTCPexato. Porta/name/credenciaisfixture sozinhos NÃO bastam; nonce eidentidadereais precisamcoincidir. Cliente tem connectionTimeout3s/queryTimeout5s.

Cada callback cria schema NOVO aleatório t_materials_<nonce>_<random12> semDROP/IFNOTEXISTS; colisãofalha. ApósCREATE, owner/commentvinculamcleanup. Somente o schema criado nesta tentativa pode ser removido; cleanup revalidaURL/cluster/owner/comment eDATABASE_SCHEMAexatoantesdohelper_close. Identidade incerta implica falha/reconciliação dafixture, não limpeza dequalqueroutroschema. db.init real semeia catálogos apenas nesse schemafictício; isto NÃOéconsultasomenteleitura.

Oarquivo NÃO criaPG/Docker/serviço/portas eNÃOéumlauncher. A execução exige harnessrootrevisado comNode/deps/guard/PGnonce/limites/unidade/retainedexit/drain. Nunca apontar para banco real. Executar APENAS este arquivo; não invocar npmtestglobala partirdeumambientecomflagdefixture.

## Evidência realmente observada

/cache completo em /mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/.cache/materials-pg17-preparation-20261111:
- TypeScript5.9.3 transpileapenas:0diagnósticossintáticos; nãoétypechecktransitivo doteste.
- Node20.19.2 executou SOMENTE saídaCommonJScompilada comambientevazio/optin vazio:9SKIP,0PASS,0FAIL,nenhumcallbackPG. Prova default-skip-result.json pinada.
- Backend8raízes+store/rotas játeve typechecktransitivoseparado peloPerfil; o NOVOtestePG não foiincluído nessa prova.
- Nenhuma afirmação deDDL aplicado,transaçãoCAS/auditrollback real, fixture drendada oupassagemdos9testesPG. Todos continuam pendentes de execução.

Próximaetapa: typecheckdoteste/revisãoindependente e pequeno runnerPG17isolado aprovado, depois únicaexecução controlada sem disputar recurso doR16. Não integrar ou publicar estasfontes semgatecorrespondente.
