# Etapa final adiada — configurações de IA multiprovedor

Decisão expressa do responsável em 09/11/2026. **REGISTRAR SOMENTE: NÃO IMPLEMENTAR AGORA.** Executar esta ampliação por último, após a base funcional integral da plataforma estar concluída e validada. O motor atual permanece OpenAI; este documento não autoriza trocar provedor, ativar login, contratar serviços ou modificar o fluxo de execução atual. O admin-v2 completo continua sendo a prioridade vigente.

## Organização da interface

- Incluir acesso próprio a Configurações no menu principal. A organização completa desse módulo e o seletor multiprovedor pertencem à etapa final aqui adiada.
- Criar interface gráfica interativa para provedores, modelos, esforço e demais parâmetros aplicáveis. Mostrar somente opções suportadas pelo modelo/serviço selecionado.
- Restringir os controles globais de IA, credenciais e roteamento ao Administrador/Dono/Master. A autorização precisa existir no backend, além de controlar a visibilidade da interface; mapear esse papel à política de permissões consolidada ao implementar.

## Provedores e catálogo

Pré-configurar conectores para as principais empresas e permitir ampliação. Exemplos solicitados pelo responsável: OpenAI/ChatGPT e seus modelos; Anthropic/Claude (Haiku, Opus e outros); Google/Gemini; xAI/Grok; DeepSeek; Meta/Llama; Microsoft e outros provedores relevantes. São exemplos de intenção, não um catálogo verificado ou fixado nesta data.

O dropdown deverá consultar os catálogos oficiais disponíveis para acompanhar novos modelos e atualizações. Na implementação futura, verificar APIs, permissões e capacidades de cada provedor; usar cache, atualização explícita/periódica e alternativa de cadastro quando o provedor não disponibilizar descoberta oficial. Não presumir que todos exponham o mesmo catálogo, identificadores ou parâmetros.

Campos pretendidos: provedor, modelo, esforço de raciocínio quando disponível, outros parâmetros compatíveis, capacidades e limites. Detalhar os parâmetros e seus mapeamentos por modelo somente nessa etapa final.

## Autenticação e segredos

- Oferecer autenticação por chave de API/token com armazenamento criptografado, acesso restrito, exibição mascarada e meios de substituir/revogar credenciais. Não guardar segredos em Git, logs ou arquivos de documentação.
- Oferecer autenticação por login quando o provedor e o plano disponibilizarem integração oficial apropriada, como OAuth/device flow. Verificar a viabilidade nessa etapa; não presumir que assinatura de produto inclua API ou que login substitua uma chave em qualquer serviço. Não recorrer a cookies de navegador, scraping de sessões ou contorno das restrições do provedor.
- Preservar as regras de autorização, auditoria, limites e confirmação humana dos módulos que utilizarão IA.

## Modelos próprios, locais ou remotos

Permitir cadastrar um serviço/modelo definido pelo usuário, hospedado em servidor ou máquina local, com os controles necessários: endereço/protocolo, identificação do modelo, autenticação quando aplicável, parâmetros/capacidades e teste de conexão. Acesso de rede, certificados e compatibilidade deverão ser verificados na implementação; não estão sendo configurados agora.

## Roteamento por módulo e tarefa

O responsável deverá conseguir escolher qual modelo/serviço será usado em cada módulo ou tarefa e manter mais de um serviço conectado ao mesmo tempo. Exemplos pedidos: geração de documentos, assistentes/robôs, Vigia, análise de logs e testes automatizados. Incluir configuração das relações e sincronização entre serviços quando necessárias, com rastreabilidade de qual modelo/configuração executou cada tarefa. Os contratos concretos de coordenação, contexto, permissões e limites serão definidos após os módulos atômicos estarem prontos.

## Ordem obrigatória

1. Concluir e validar os demais módulos da plataforma/admin-v2 no escopo aprovado.
2. Manter OpenAI como motor atual durante essa conclusão.
3. Somente depois iniciar esta ampliação final de Configurações e seleção/roteamento de IA.

Estado deste registro: backlog futuro, sem implementação iniciada e sem alteração de configuração operacional.
