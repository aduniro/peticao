# Interface do presidente — integração local de10/11/2026

## Decisões reversíveis

Implementação conforme nova autonomia do Goal, preservando autorização separada de deploy/merge/VPS e homologação real. Controles novos usam classes/fontes existentes e comentários MUDAR AQUI. A página externa /presidente exige PRESIDENT_OWN_ENABLED=1; o padrão permanece desligado. Código, senha, CPF e nascimento só em memória, nunca URL/storage. Somente UUID e vínculos não secretos da emissão podem persistir na sessão administrativa.

Backend deriva documentVersion dos bytes reais, reautentica Total/stepup e audita leitura. SSR cruza hashes/versão/perfil; contexto divergente não habilita emissão. Perfil usa CAS; perda de resposta exige consulta explícita. Recibo próprio não libera envio ICP. A página do presidente é excluída de analytics e controles públicos de compartilhamento, sem modificar a página principal.

O renderer próprio acrescenta uma página antes da assinatura A1 e rejeita fontes com assinatura. Ainda é função interna; integração durável/seleção A1 em implementação. A preferência antiga do formato permanece registrada; nenhuma versão real é reescrita ou produzida por essa decisão provisória. PDFs de QA usam apenas dados fictícios.

A tabela de versões gov.br recebeu largura mínima600px dentro da rolagem existente: preserva fontes e evita esmagamento das ações no celular. Confirmar em seis larguras na QA compilada.

## Validações anteriores à integração administrativa

Cumulativa8d1b8c6:914 aprovados,0 falhas,1 suspenso. Diretório /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/full-1794296432091659317.
Portal externo/contexto:24 testes backend e tipos com fontes estáveis em /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794297707518395055/result.json e /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794297707424953515/result.json. Mais6 testes puros de transporte/caminhos passaram; não somar contagens como cobertura independente.

Rascunhos externos preservados com decisões/evidências: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-ui-next-draft; /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-admin-next-draft; /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-pdf-next-draft. Seus testes isolados não comprovam integração Next/PostgreSQL.

## Aceite ainda necessário

Tipos/build e testes dirigidos do conjunto integrado; navegador compilado com produção fictícia+bridgeUnix de identidade; perdas de resposta; troca de lote/perfil/documento; seis larguras; revisão visual PDF final. Persistência imutável e ligação nativa→A1 ainda não concluídas. Certificado real A1 continua indisponível.

## Conjunto integrado dirigido

45/45 testes e tipos estritos passaram com fontes/commit estáveis, staged sobre8d1b8c6. Evidências: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794298052573298275/result.json e /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794298052490379197/result.json. SHA dos arquivos conferidos antes de registrar commit. Harness compilado inclui fluxo externo e extensão admin real; execução ainda pendente.
