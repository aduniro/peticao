# Etapa 3 — prévia protegida de mensagens

Implementação no candidato, sem deploy e ainda sem controles novos na interface. Não altera o original arquivado, os modelos enviados ou a política de retenção.

## Autorização e estados

`GET /api/admin/emails/mensagens/previa?id=<uuid>` exige Total, sessão ativa, origem permitida e confirmação extra vigente. Não recebe autor, veredito ou opções de conteúdo do navegador. Somente o autor da sessão é registrado na auditoria. A prévia pronta só é retornada após gravar `mail_message_preview`; falha de auditoria impede a resposta de conteúdo. Respostas de dados são no-store, nosniff e no-referrer.

Mensagem inexistente/ID inválido não produz conteúdo. Estados indisponível, expirado, adulterado e limite excedido são distintos. Autenticação/senha/convite/reset/OTP e tipos administrativos ficam restritos, sem descriptografar seu conteúdo. Não se oferece cópia bruta, anexo para download nem leitura automática de e-mails antigos sem arquivo. A política de retenção continua sem ativação automática.

## Transformação de exibição

O parser interpreta HTML antes da geração de outro documento com elementos fixos permitidos: texto, títulos, tabelas, listas e ênfase. Só atributos/valores CSS restritos são reemitidos. Scripts, handlers, formulários, conteúdo SVG/MathML, frames, estilos originais, imagens, href/src e demais recursos ativos são removidos. Não há busca de imagens/logos remotos ou de anexos. Estilos básicos de cor/espaçamento/tipografia são conservados quando permitidos; a resposta marca `transformed=true`. Não é reprodução exata do HTML original.

Máscaras conservadoras cobrem URLs, caminhos conhecidos de confirmação/admin, tokens longos, códigos formatados, OTP numérico e CPF. A análise concatena nós de texto antes de mascarar, decodificando entidades e removendo caracteres invisíveis; depois escapa o texto. Isso trata tokens divididos por elementos inline. Pode ocultar números/textos adicionais: não é classificador universal de segredos e não substitui a autorização ou a restrição de mensagens de autenticação. Assunto/texto e nomes de anexos também são tratados; anexo só informa nome/quantidade de bytes, nunca seu conteúdo.

Limites: corpo HTML e texto até 256 KiB cada, assunto até 2 KiB, até quatro mil delimitadores de tag, dez mil nós/depth 80 e cem metadados de anexos. Exceder limita a prévia, sem reescrever o arquivo. As buscas de máscaras usam intervalos e busca binária, sem varrer todas as máscaras para cada nó.

## Isolamento obrigatório no cliente

A futura interface deve usar iframe `sandbox=""` e `srcDoc`, sem allow-scripts, allow-same-origin ou permissões adicionais. Nunca inserir a prévia como HTML dentro do DOM administrativo. O documento inclui CSP sem rede/scripts e referência no-referrer. Sandbox depende do atributo do iframe: a diretiva CSP sandbox não funciona em meta e não é apresentada como proteção ativa ali. Campos JSON de assunto/anexos devem ser renderizados como texto.

A prévia isolada não é editor nem corpo autorizado para reenvio. Editor/versionamento e envio dependem de contratos próprios. Não houve mudança de avisos/títulos/controles do painel antes da aprovação do dono.

## Dependências e fontes

`parse5` 8.0.0 e `entities` 6.0.1 foram acrescentados ao lock; versões de todas as dependências anteriores foram preservadas. A versão foi fixada para o Node 18.19.1 usado aqui; a atualização seguinte de entities exige Node mais novo. A compatibilidade real de build/execução será conferida, sem atualizar o Node da VPS neste escopo. Dependências do candidato estão isoladas em `/home/barre/.cache/peticao-admin-deps-preview-v1`; não foi substituído node_modules dos outros ambientes.

Referências primárias: [parse5](https://parse5.js.org/), [manifesto da versão 8.0.0](https://github.com/inikulin/parse5/blob/v8.0.0/packages/parse5/package.json), [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) e [limites da diretiva CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox).

## Evidências e limites da etapa

Oito testes específicos cobrem renderização, entradas malformadas, fragmentação de tokens, limites, preservação, estados, auditoria e autorização HTTP por nível/step-up. A primeira falha de máscara foi preservada para comparação: uma fronteira entre blocos impedia reconhecer código formatado adjacente a um dígito. A correção não afrouxa o teste. O primeiro arranque do PostgreSQL isolado também foi preservado: os pacotes instalados com ignore-scripts precisavam hidratar seus próprios links; foi executado rebuild somente desses pacotes de desenvolvimento.

Roteiro `tools/admin-qa/mail-preview.mjs`: endpoint compilado, autenticação e iframe real em seis larguras; não ignora requisições externas ou exceções. Logs em `/mnt/dev/peticao/.cache/admin-audit-20261106/stage03-preview-*` e capturas/relatório em `runtime-mail-preview/`. Nenhuma consulta externa do CPF, envio real, modificação de revisão/assinaturas ou instalação remota está autorizada por esse roteiro.

Continuam pendentes interface, política de arquivo/retenção de todas as cópias, IDs/eventos reais, recuperação operacional, conversas/editor e demais Etapas 2–7. Este checkpoint não conclui a integração integral.

## Resultado final do checkpoint

**343/343 cumulativos**, oito específicos, build, tipos após build e HTTP compilado + navegador nas seis larguras aprovados. O relatório `runtime-mail-preview/mail-preview.json` comprova zero requisições do documento a rastreadores, sandbox sem acesso ao pai, máscaras e autor da auditoria. Capturas 320/390 foram também inspecionadas visualmente. Sessão fictícia revogada, navegador e servidor temporário 3032 encerrados; prévia 3031 retomada e `/admin` respondeu 200. A pasta de e-mails dev deste ensaio permaneceu vazia; registros de assinaturas/mensagens/tentativas/filas foram preservados pelas consultas.

A comparação de dependências (`stage03-preview-dependency-comparison.json`) confirma 150 versões anteriores preservadas, sem pacotes removidos/atualizados; só parse5/entities foram acrescentados. O build final é `stage03-preview-build.log`; os logs de tentativa de preparação/interrupção anteriores não são certificação de build. O aviso de CSS já existente foi conservado sem alteração visual solicitada.

AV-9 foi perguntado e continua pendente; não houve ativação de novo botão/aviso. Nenhum schema, banco real, regra pública, revisão local ou arquivo da VPS alterado. As demais prévias existentes, incluindo o card de contato, ainda devem ser conferidas antes da integração visual final; este ensaio certifica o contrato novo, não todos os iframes do painel.
