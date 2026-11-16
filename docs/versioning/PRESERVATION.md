# Preservação, referências e privacidade

O histórico original foi preservado em bundles privados verificados, fora da árvore de trabalho. Arquivos pendentes e patches foram capturados antes da preparação desta publicação. Os hashes públicos podem diferir dos originais por sanitização; a migração mantém o mapa de commits e a procedência privada.

As referências originais do repositório principal foram preservadas. Histórias independentes de ferramentas e protótipos estão em `archive/component-NNN/*`; commits úteis de HEADs destacados têm referências de arquivo. Snapshots parciais de backups não foram tratados como alterações funcionais nem transformados em commits de exclusão.

Foram excluídos da publicação arquivos operacionais privados, configurações de execução `config.json`, correspondência privada e capturas externas HTML. Configuração real deve ser mantida em arquivo privado e preparada conforme o componente. Não copiar dados reais ou configuração de produção para criar um ambiente DEV.

Identidades de um fixture sem procedência sintética comprovada foram substituídas por dados sintéticos determinísticos na cópia pública. Contatos privados do operador foram substituídos por placeholders; destinatários operacionais exigem configuração privada explícita. Contatos públicos institucionais e a autoria original do Git são preservados. A cópia privada original não foi reescrita.

As réplicas privadas integrais para Oracle, Civo e Akamai são outra entrega: incluem arquivos ignorados, dados e backups autorizados, com verificação e consistência apropriada. Elas não são obtidas por `git clone` e não devem reapresentar ao remoto público a história original privada.

Antes de usar branches arquivadas em desenvolvimento público, partir das referências sanitizadas deste remoto. Nunca fazer mirror-push do Git original privado. O manifesto de componentes permite localizar a história e reconstruir worktrees; a migração não afirma que todos os protótipos foram implantados.
