# Procedimento revisável: Neon interno, ainda não aplicado

Operador real: Infra01a1d130, ator delegadoadmin-recuperacao; delegação
`/mnt/apps/peticao-final/_ops/operacao-automatica-20261114/DELEGACAO-INFRA.json`.
O projeto de São Paulo e todos os arquivos ENV do app permanecem intocados.

## Inspeção e credenciais
`provision_neon.py` sem flags faz só GETs, com CLI9.5.0 instalada localmente.
Perfil explícito `peticao-coordenacao`, credencial existente0600 do usuário
atualmente autenticado; nenhuma chave é criada/copiada/posta em argumentos.
O CLI captura stdout/stderr em arquivos privados0600; não imprimir logs brutos.
Organização verificada ao vivo: org-fragrant-dawn-99551288, planoFree.

## Aplicação após revisão técnica
1. Congelar este procedimento/código/testes no commit anunciado, conferir hash
   e ACKs reais do manifesto novo. Não reaproveitar aprovação de2586 para pin novo.
2. Adquirir lease próprio `operation=deploy`, destino
   `deploy:peticao-infra-cloud-us`, com o evento do manifesto revisado; salvar
   token/fence em arquivo privado. Não compartilhar tokenRoot.
3. O CLI atual adiciona `code:` global e verifica avisos pendentes. Enquanto
   houver fonte Admin reservada ou Executor61 sem ACK real, NÃO aplicar.
4. Executar `provision_neon.py --apply --critical-lease-file ARQUIVO_PRIVADO
   --manifest-event EVENTO_REVISADO`. O código valida lease ativo, operação,
   destino e evento imediatamente antes das mutações. Uma execução por lockflock.
5. Revalidar Free; enumerar todas as páginas e rejeitar listagem parcial. O
   alvo único é peticao-infra/aws-us-east-1/PG17; não adotar homônimo sem recibo
   vinculado ao ID da resposta de create. Intenção exclusiva/durável (O_EXCL,
   fsync de arquivo e diretório) registra ausência antes POST. Nome/data não provam posse.
6. Criar com `.25CU` fixas, DBinfra/roleinfra_owner, `--no-secrets`, sem set-context.
   Reconciliar ID pela API, validar endpointquarter/timeout0ou300. No Free,0
   significa padrão do plano300segundos, e não é ajustável: não forçarPATCHpago.
7. Criar infra-artefatos explicitamenteprivate; listar novamente e verificar
   access_level. Conferir Auth/DataAPI/Functions pelo configlive, Realtime
   enabledfalse e disponibilidade do gateway por GET; nenhuma credencial de IA
   é criada e nenhuma invocação é feita. URL disponível não significa uso pago.
   Se API/campo não provar estado desativado, parar e reconciliar, nunca presumir.
8. Guardar recibos IDregião/branch/endpoint/CU/privacidade. Estado continua
   operacionalReadyfalse até smokeSQL+roundtripStorage+observação de suspensão.

## Validação posterior sem consumidor permanente
Usar somente a URL do projeto novo, obtida pelo CLI para infra_owner/infra e
capturada em arquivo privado ou pipe; nunca argv/log público/app.env.
Executar SELECT1/current_database()/version e encerrar conexão imediatamente.
Enviar objeto de poucos bytes via bucket object put, baixar via get e comparar
SHA256; preservar esse objeto de evidência. Conferir ausência de acesso público.
Após cinco minutos sem SQL, observar endpoint pela API de controle, sem heartbeat
SQL. Não declarar wake/sleep nem serviço conectado antes desses testes reais.

## Falha, idempotência e rollback
POST incerto não é repetido: consultar todas as páginas/estado das operações e
recibo ID da resposta real; sem ID, exigir reconciliação explícita por Root com
evidência da operação. Nunca inferir posse por nome ou data. Preservar e parar.
Reexecução com recibo próprio reutiliza projeto e bucket; recusa homônimos,
versão/região inesperadas, bucketpúblico e compute fora do limite.
Recibo fixa endpoint_id ebranch_id; compute substituído ou falta do pin após
crash exigem reconciliação explícita antes de retomar/suspender qualquer coisa.
Rollback autorizado é `--rollback-suspend` com o mesmo gate crítico: desabilita
endpoint próprio e agenda suspensão, preservando projeto/PG/bucket/objetos.
Nenhum DELETE, DROP, truncate, exclusão de fontes ou histórico é implementado.
Verificar suspensão pela API e recuperar com endpointdisabledfalse após novo
gate válido. Se houver dados novos, mantê-los e exportá-los de forma consistente
antes de qualquer futura exclusão separadamente autorizada. Storagepersiste.
