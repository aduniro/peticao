# Inicialização aditiva de Materiais — rascunho

Base exata: `140ce6b98af23045849335693a82b426fdc9c826`.

Checkout: `/mnt/apps/peticao-final/_ops/drafts/materials-schema-init-20261111`.

O inicializador existente de `/mnt/apps/peticao-final/_ops/drafts/materials-schema-init-20261111/site/src/lib/db.ts` passa a executar o DDL já existente de Materiais depois dos esquemas documentais e antes dos seeds/backfill existentes. A ordem das operações anteriores não muda. Não há novo executor de migrações, remoção de dados, alteração do DDL ou habilitação da flag `MATERIALS_LIBRARY_ENABLED`.

Isso fecha uma lacuna do rascunho: a bateria HTTP anterior aplicava o DDL na fixture explicitamente. Sem o registro, uma instalação que apenas inicializasse a aplicação não criaria as tabelas necessárias aos endpoints de Materiais.

O DDL preserva versões/recibos e admite reaplicação conforme a bateria PostgreSQL fictícia já aceita. Desabilitar a flag é o retorno funcional; não excluir as tabelas para desfazer uma publicação. O tratamento existente de falha em `init` limpa a promessa de inicialização e propaga o erro; a rotina não ignora falhas do novo DDL.

Esta alteração ainda não foi integrada, aplicada em produção ou validada pelo aplicativo compilado. A prova HTTP anterior continua vinculada à fonte `140ce6b98af23045849335693a82b426fdc9c826`, não a este novo diff. A futura união deve executar a inicialização real sobre um banco fictício inicialmente vazio, repetir o acesso preservando os materiais criados, verificar as tabelas/constraints e testar a flag desligada antes do aceite.

Não foram alterados os fluxos bloqueados de envio sem assinatura, editor de Contatos/IA ou preparação R16.
