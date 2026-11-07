# Etapa 5 — base comum com fontes rastreáveis

07/11/2026. Busca e resolução de fontes no candidato local, sem nova tabela, interface ativa ou publicação. Não conclui as funções de IA ou a integração inteira.

## Três usos preservados

`painel`, `divulgacao` e `atendimento` compartilham a base. Leitura pode consultar o contexto do painel; os outros dois usos exigem Edição. A configuração interna de conferência de nomes é fonte apenas do painel: não entra no contexto de divulgação ou de respostas aos participantes.

O catálogo importa explicitamente partes do texto da petição, pontos da campanha e campos selecionados da política de validação. Não percorre diretórios, não aceita caminhos e não indexa segredos, configurações de ambiente, contatos, assinaturas, eventos ou corpos de e-mail. Os textos da campanha são material do repositório, não comprovação atual da situação legislativa.

Referências de campus vêm da última decisão de cada caso, somente se aprovada e com fonte declarada conferida pelo revisor. Não expõe contato, autor, relato ou impressão da intenção. Revalida a forma canônica e a classificação pública: registro malformado, com campos extras ou desatualizado é omitido e contado como pendência. Não reescreve o histórico nem publica campus. Rejeição posterior retira a referência da busca e da resolução de citação atual.

## Consulta e proveniência

`POST /api/admin/conhecimento` recebe `{uso,consulta,limite?}` ou `{uso,fonte,versao}`. Exige sessão, mesma origem, corpo de até 2.048 bytes e chaves exatas. Consulta tem até 240 caracteres e 12 termos úteis; recusa CPF/e-mail digitado. O corpo não é salvo pelo serviço. Nenhuma alegação é feita sobre configurações externas de logs do proxy.

Busca lexical normaliza acentos e limita resultados a dez. O PostgreSQL traduz decomposições latinas de um caractere sem extensão nova. Considera até 50 referências de campus relevantes; truncamento, fonte indisponível e curadorias inválidas/desatualizadas são explícitos. Fonte ausente não vira prova de que não há referência. Limite de ranking também é informado.

Cada documento tem ID estável, referência ao campo de origem, versão SHA-256 do conteúdo/proveniência, finalidade e tipo de fonte. A resolução exige finalidade permitida e versão exata atual; versão divergente é recusada. Fonte retirada não continua autorizada por uma citação antiga. O histórico original continua na curadoria; esta API não é um visualizador completo de versões históricas.

## Limites de execução

Operações de banco são somente leitura, com snapshot consistente, timeout e savepoint para degradação da fonte de campus. Texto de fonte é dado, não autorização para comandos. Não invoca modelo, busca URL, grava consulta, envia e-mail, altera cadastro ou publica referência. Não interpreta disponibilidade de um provedor/modelo nem presume credenciais existentes. Configuração de provedores/modelos/esforço, limites de custo, contexto das três funções, minutas e interfaces continuam pendentes; não rotular esta busca como IA funcionando.

## Verificação

Passaram **16/16 direcionados e 430/430 cumulativos**, incluindo oito testes novos, build e typecheck serial. Cobrem fontes/versionamento, três usos, acentos, retirada, conteúdo privado ausente, leitura sem escrita, limites, degradação e permissões/origem. O HTTP compilado também passou: os três usos consultaram a mesma referência aprovada, cada citação resolveu sua versão exata, a rejeição retirou a fonte antiga e a busca seguinte refletiu a mudança, com assinaturas/fila/respostas/JSON público preservados. Sessões fictícias revogadas e prévia original 3031 restaurada com banco/configuração anteriores, HTTP 200. Sem mudança de DDL: não se repetiu o ensaio de onze tabelas já aprovado sobre o mesmo esquema.

A primeira rodada HTTP falhou numa asserção de texto exato do `Cache-Control`: o Next.js acrescentou diretivas e manteve `no-store`. Corrigiu-se apenas o roteiro para exigir a diretiva, recusar cache público/idade positiva e aceitar a composição do framework. Não se alterou o app nem suas proteções. A repetição usou banco fictício novo e o mesmo build/tipos/código aplicativo já aprovados. O roteiro integrado `tools/admin-qa/knowledge.mjs` respeita a janela real de taxa antes de retomar a curadoria; não altera nem contorna limites. Artefatos iniciais e finais foram preservados.

Evidências na cache de auditoria: `stage05-knowledge-targeted.log`, `stage05-knowledge-cumulative.log`, `stage05-knowledge-build.log`, `stage05-knowledge-typecheck-serial.log`, `stage05-knowledge-runtime.log` (asserção inicial), `stage05-knowledge-http-final-runtime.log` e `runtime-knowledge-final/knowledge.json`. Não equivalem a teste de interface ainda não conectada, inferência de IA ou publicação.

AV-10 aprovado; outros textos/retencão sem aprovação inferida. Nenhum aviso ou controle novo foi ativado. Demais etapas permanecem no objetivo; deploy final depende da autorização do dono.
