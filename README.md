# Checkpoint privado R4 antes de atualizar runtime

Branch infra/history-native-pg17-r4, proposta local congelada. Base infra4ddb04347bbcb63b6be61185f1ff488f10a59b9d preserva perfil480 runtime-http-r0000-v1.

Contexto baseline desta fotografia: source0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f, harnessoriginalca53ba684fc4021760069e6f79a1ca75475d3e6b, adaptações em r4_harness para contexto tipado de job/geração/boot/digest/cgroup, sem transportar lease ou SQLite, guardInstalled obrigatório e pinsPG17. Toda implementação aqui é proposta, não instalada.

61fixtures locais passaram (36fila/perfis,21lifecyclePGmock,4runtimepreflight). ZERO19HTTPexecutados, nenhumPGreal/SSH/instalação. Recursos propostos2CPU3GiB600sexec+120sgrace(total720),semalterar480/genéricos. Exportador allowlist copia sórecibos/PDFs sintéticos, nãoPGDATA/pgpass/runtime/leases.

O responsável pediu atualizar para runtimef555maisrecente; será contexto separado em /mnt/apps/peticao-final/_ops/r0000-cluster-history-native-pg17-r4-20261110/r0002. Esta fotografia não comprova qualificação do R0002. Evidências locais foraGit em /mnt/apps/peticao-final/_ops/r0000-cluster-history-native-pg17-r4-20261110/evidence.
