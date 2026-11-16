# Petição / SancionaIntegral

Código da aplicação pública, backend, admin-v2, ferramentas de assinatura e componentes de coordenação e desenvolvimento.

A branch de entrada `integration/project-20261116` parte do checkpoint Admin-v2 R1, com documentação e fontes operacionais acrescentadas sem integrar WIPs funcionais. A branch histórica `main` foi preservada; ela não representa automaticamente o último código do Admin-v2 nem todos os serviços publicados.

## Começar

```bash
git clone https://github.com/aduniro/peticao.git
cd peticao
cd site
npm ci
```

Use o perfil Node/npm aprovado pela Infra. As versões dos pacotes da aplicação são as do `site/package-lock.json`; não executar atualização indiscriminada de dependências. A configuração privada e um PostgreSQL DEV isolado devem ser preparados antes de iniciar o app ou testes que usam banco. Nunca apontar testes para o banco de assinaturas em produção.

Consulte [desenvolvimento reproduzível](docs/versioning/DEVELOPMENT.md), [manifests e perfis](docs/versioning/REQUIREMENTS-BASELINE.json), [mapa de componentes e branches](docs/versioning/COMPONENTS.json) e [preservação e privacidade](docs/versioning/PRESERVATION.md).

## Organização

| Caminho | Conteúdo |
|---|---|
| `site/` | Aplicação Next.js, backend, admin-v2, testes e ativos públicos |
| `tools/signing/` | Código de assinatura, requisitos fixados e testes; certificados operacionais são externos |
| `tools/` | Ferramentas de desenvolvimento, comunicação, dados institucionais e QA |
| `_ops/controle-operacional/` | Fontes da coordenação operacional |
| `_ops/coordenacao-dupla/` | Protocolo e ferramentas de coordenação |
| `_ops/whatsapp-executor/` | Fontes da ponte Vigia/Executor; exige configuração privada explícita |
| `_ops/kubernetes-dev/` | Fontes de desenvolvimento Kubernetes |
| `infra/`, `infra-toolchain-publication-20261115/` | Ferramentas de infraestrutura e fontes do instalador |
| `requirements/` | Perfis Python separados por finalidade |

As branches `archive/component-NNN/*` preservam histórias de componentes e protótipos, não qualificam esses componentes como implantados ou aprovados para produção. O manifesto informa a origem relativa e o namespace; fontes arquivadas podem precisar de reconstrução de ambiente.

Produção, banco de assinaturas e fluxo PDF/assinatura continuam na VPS São Paulo. Oracle é a futura central planejada, sem cutover nesta migração. A padronização do ambiente tem como referência o perfil Civo sob responsabilidade da Infra.

`email-verifier` e `resolvedor-nomes` são aplicações independentes e têm repositórios próprios. Dados pessoais, bancos, backups, credenciais e conversas não são distribuídos neste repositório.
