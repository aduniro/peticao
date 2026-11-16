# Desenvolvimento e dependências

## Aplicação e banco DEV

O manifesto e o lock do `site/` são os mesmos do checkpoint Admin-v2 R1. O PostgreSQL de produção São Paulo continua separado. Existem perfis históricos com locks diferentes: não substituí-los pelo lock atual nem assumir que toda imagem publicada usa a mesma versão.

Instalação da aplicação: `npm ci` dentro de `site/`. Os scripts declarados podem ser consultados com `npm run`. `npm run build` compila; `npm start` inicia o servidor. Não são executados automaticamente pela migração. Credenciais, configuração de e-mail e conexão com banco devem ser fornecidas por configuração privada; dados reais não são necessários para desenvolvimento.

Testes Node/TypeScript: o script `npm test` usa o wrapper de banco do projeto. Antes de executá-lo, conferir o wrapper e configurar exclusivamente um banco DEV descartável. `npm run typecheck` verifica tipos sem publicar. Não usar rotas de envio ou provedores reais como teste sem a tarefa correspondente.

## Python por componente

Criar um venv próprio por perfil, sem alterar o Python do sistema. Exemplo declarativo:

```bash
python3 -m venv "$HOME/.local/share/peticao-venvs/assets"
"$HOME/.local/share/peticao-venvs/assets/bin/python" -m pip install -r requirements/assets.txt
```

| Perfil | Uso | Origem dos pins |
|---|---|---|
| `requirements/signing.txt` | Ferramentas de assinatura | Lock existente de 16 distribuições, preservado |
| `requirements/assets.txt` | Pillow/xlrd para preparação de ativos institucionais | Metadados do ambiente Dell observado |
| `requirements/legacy-cpf-pdf.txt` | Ferramentas históricas de PDF/CPF | Metadados locais e fechamento das dependências sem extras para Python 3.12/Linux |
| `requirements/qa-python.txt` | pytest em ambiente isolado | Metadados locais e fechamento de dependências sem extras |
| `requirements/project-credentials.txt` | Helper privado de credenciais | Conjunto criptográfico/HTTP já fixado pelo projeto |
| `requirements/speech.txt` | Transcrição opcional do executor | Pins existentes; componente opcional, não requisito do servidor público |

Os novos perfis baseados em metadados registram versões e satisfazem as dependências declaradas no recorte CPython 3.12/Linux; isso não representa teste funcional completo em todos os hosts. Os perfis históricos de monitor e QA mantêm requisitos próprios nas respectivas branches. Não misturar todos os requirements no mesmo venv.

## Navegador, ferramentas nativas e portabilidade

Playwright JS/Python e seus navegadores são dependências de QA separadas do servidor. Há perfis históricos distintos (incluindo JS 1.58.2 e 1.62.1); usar a versão e a revisão de navegador do perfil de teste escolhido. A baseline completa do host é congelada pela Infra e será registrada quando a evidência estiver disponível; não foi deduzida de um snapshot antigo.

Git, Node/npm, Python/venv, PostgreSQL cliente/servidor DEV e, conforme a tarefa, Docker/Compose/Buildx, Chromium/Playwright e ferramentas PDF/fontes precisam ser instalados pelo perfil de host. K3s não é requisito para editar ou testar isoladamente a aplicação; os clusters DEV são independentes. Não ingressar hosts em um cluster nem iniciar serviços só por clonar.

Alguns harnesses históricos usam caminhos absolutos ou caches externos da máquina original. O histórico foi preservado para consulta; esses harnesses devem receber o prefixo/ambiente compatível antes de reuso. `node_modules`, venvs e browsers não são sincronizados pelo Git. Não seguir symlinks de cache para incluir bibliotecas externas no repositório.

## Integração distribuída

Cada agente usa clone/worktree e branch próprios. Publicar commits pequenos, executar os testes pertinentes e integrar pelo fluxo coordenado. GitHub guarda código/versões; a integração Neon/fila é uma frente separada, sem transferir o banco de assinaturas. Deploy continua uma operação explícita com artefato exato, healthcheck e rollback.

## Perfil adicional de coordenacao

`requirements/coordination.txt` referencia o lock com hashes do adaptador PostgreSQL/Neon: psycopg/psycopg-binary 3.2.13 e typing_extensions 4.16.0. Instalar com `pip install --require-hashes -r requirements/coordination.txt` em venv separado. O lock inclui wheels Linux x86_64/aarch64 para Python 3.11/3.12/3.13; nao altera os locks do app ou do A1. Credenciais de owner/reader/writer ficam em configuracao privada. Esta publicacao nao troca a fila ativa nem migra o banco de assinaturas.

## Baseline Civo V1 congelada

O manifesto e contrato imutaveis estao em `docs/versioning/host-baseline-civo-v1/`. V1 libera cinco perfis: Node22.23.5/npm10.9.9, Python PBS3.12.3, dependencias npm do app, ativos PDF do navegador e coordenacao Databases. Quatro perfis permanecem pendentes nessa fotografia: A1/oscrypto, QA JS, QA Python e K3s Civo. Nao interpretar este freeze parcial como qualificacao completa do app ou de todos os hosts. Revisoes posteriores devem ser publicadas com nova versao, sem substituir V1 silenciosamente.

## Delta imutavel Civo V2

`docs/versioning/host-baseline-civo-v2/` preserva a V2, os sete recipes/locks e o patch minimo oscrypto com guardas de hashes. Soma A1 DEV com overlay explicito (nao wheel original sem patch) e QA JS1.62.1/Python1.62.0/Chromium151 revision1234. V1 permanece intacta. Aplicar apenas o delta em prefixo isolado e repetir smoke por host; nao copiar venvs, credenciais ou certificados para o Git. Validacao sintetica DEV nao comprova assinatura ICP/producao. K3s Civo mantem escopo pendente na fotografia V2 e nao impede a disponibilidade do codigo do app.

## Coordenacao revisao 2

`COORDINATION-PROFILE-v2.json` identifica a revisao 2 das fontes Databases, acrescentada em commit incremental preservando V1. O owner reportou 25 testes PostgreSQL reais e uma regressao focada de TTL apos rowlock. A revisao inclui guardas de identidade SQLite e concorrencia SHA. A homologacao dos hosts e a adocao operacional continuam sob Databases/Root/Infra; o codigo publicado nao muda a fila ativa ou o banco de assinaturas. O lock de dependencias b347 permanece o mesmo.
