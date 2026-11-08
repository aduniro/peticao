# Captura privada da plataforma publicada na VPS

Repositório LOCAL independente, sem remoto e sem merge com desenvolvimento.
O diretório app contém código-fonte e configurações de build sem arquivos de
ambiente, banco, segredos, dependências ou build. O manifesto registra origem,
modos originais, tamanhos e SHA-256. Não executar o aplicativo com dados reais.

O backup integral e exato (incluindo build, dependências e configurações privadas)
está em ../private/platform-full.tar.gz. Os bancos e papéis PostgreSQL estão em
../private/*.dump e ../private/postgres-globals.sql. Nunca adicionar esses
arquivos a este repositório ou a um remoto. O arquivo ../capture-manifest.json
registra os checksums privados da captura. Esta separação é intencional.

Os dumps de cada banco têm seu próprio snapshot consistente e contagens feitas
no MESMO snapshot. Arquivos/configuração foram capturados em outra janela
explicitamente registrada; não se trata de um snapshot atômico do disco inteiro.
Nenhum código, repositório ou serviço da VPS foi modificado pela captura.
