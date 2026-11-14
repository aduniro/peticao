# INFRA-US-CPU-20261114-v2 — plano aprovado

Proprietário aprovou na conversa permanente Infra: `Implement the plan.`
Implementação não exige nova autorização do dono para etapas já abrangidas.
Estimativa:8–16h operacionais, fora espera de fornecedores e etapa Admin-v2.

## Objetivo
Desenvolvimento independente do Dell, que será apenas trabalhador opcional.
Sem Leaseweb (conta não validada), GPUs ou sessões GPU/TPU nesta fase.
Sem aumento de despesa recorrente atual após créditos; banco de assinaturas SP preservado.

## Alvos
- Akamai Miami existente6CPU/16GB/320GB: central permanente/contextos/controle.
- Civo NYC g4c.medium16CPU/32GiB/80GB mais volume200GB: trabalhador principal.
  Criar apenas após saldo e vencimento comprovados, preço e capacidade reconfirmados.
- Azure EastUS Standard_D16as_v5 16CPU/64GiB: trabalhador complementar.
  Computação consultadaUSD0.688/h; discos/rede adicionais. CréditoUSD200,
  vencimento2026-12-14T00:13:41Z. Confirmar quota; fallback D8as_v5 e depoisD4as_v5.
- Neon aws-us-east-1 projeto peticao-infra: PostgreSQL interno e bucket privado
  infra-artefatos; Auth/Realtime/Functions/DataAPI/AIGateway inicialmente desativados.
- Vultr SP: manter produção e banco. Santiago: preservar até cutover validado.
- Nenhuma nova VM nas demais contas sem orçamento/eligibilidade/capacidade comprovados.

## Energia e dinheiro
Civo/Akamai/Vultr/DigitalOcean cobram máquinas desligadas: manter ligadas durante
alocação financiada, concentrando trabalho útil. Na Azure desalocar após10min
sem tarefas elegíveis/em execução/finalização/exportação. Sem limite fixo8h/dia.
Reservar20% dos créditos comprovados para conclusão/encerramento/residuais;
computar cobranças fixas e comprometidas antes de admitir tarefas.
Antes de admitir trabalho, exigir timeout conhecido e cobertura até conclusão.
Drenar antes do vencimento; exportar/verificar resultados e remover recursos
temporários cobrados até exclusão. Sem crédito/quota comprovados: não criar.
Não manter banco Neon acordado com heartbeat SQL. Uma única fila autoritativa.

## Sequência
1. Prioridade QA Admin-v2 em Akamai existente: proposta4CPU/8GiB/30GiB,
   HTTP3171/PG54511 privados; Root reserva e encaminha worker existente.
2. Confirmar créditos/quota/preços; registrar autoridade e reservas próprias.
3. Provisionar somente alvos qualificados e acesso tailnet privado.
4. Criar Neon interno sem tocar ENV/banco do app; autosuspend e limites Free.
5. Cópias consistentes verificadas: repos, WIP, contextos, configurações e fila.
6. Cutover somente após recibo Root de etapa Admin-v2 completa, reservas e ACKs
   técnicos reais; nunca duplicar escritor/fila/control-plane.
7. Controle determinístico por eventos, sem polling LLM e sem depender do Dell.
8. Auditar dependências WhatsApp antes de mover; comunicação não fica apenas
   em host temporário. Root envia relatório HTML pelo Vigia autorizado.

## Aceitação
Build/QA da mesma revisão aprovada; Dell desligado sem interrupção; Azure
inicia/desaloca por demanda; recuperação isolada; tarefas sem duplicação/perda;
Neon suspende/retoma; limites financeiros testados; produção SP íntegra.
Registrar separadamente planejado/enviado/aceito/provisionado/testado/ativo.

## Complemento do proprietário após aprovação
Se o maior alvo não puder ser criado, escrever primeiro ao fornecedor explicando
o projeto e pedindo liberação; depois usar segunda opção dentro dos créditos.
Verificar aprovação do pedido Vultr IVL-93RSN e aplicar upgrade de Santiago para
a maior capacidade elegível com orçamento comprovado e janela Root, sem trocar
limites financeiros nem reiniciar serviços ativos sem coordenação.
