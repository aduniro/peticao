# Operação dos relatórios por e-mail

Destino autorizado do responsável: operator-1608598f41@example.invalid; corpo HTML. Preservar o registro de cada tentativa. Aceite202 do provedor não comprova entrega na caixa de entrada.

Em 10/11/2026, o MailerSend rejeitou o anexo JSON do relatório com HTTP422/MS42202 (nome e tipo de arquivo reconhecido incompatíveis). Esse erro veio da API de envio, não de DNS/Cloudflare. Não houve alteração de DNS.

A correção validada manteve o JSON original dentro de um ZIP real, com extensão e conteúdo ZIP corretos. Não renomear a extensão de um arquivo para simular outro tipo. A tentativa original rejeitada e a tentativa corrigida têm registros separados; não foi repetido um resultado incerto.

- Rejeição: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/owner-progress-1794290906251052252/email-report-corrected-result.json`.
- Correção e preservação do conteúdo: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/owner-progress-1794290906251052252/attachment-correction.json`.
- Aceite202: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/owner-progress-1794290906251052252/email-report-attachments-fixed-result.json`, ID6af2b57ee6eab699793f6b0c.

Na pasta do relatório, o arquivo original continua registrando422. Para o último estado real, consultar o registro corrigido indicado acima ou o ponteiro `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/latest-owner-email-result-path.txt`. Não concluir que o último envio falhou apenas por ler o primeiro registro da pasta.

Nos próximos relatórios, verificar tamanho, tipo real, nome e checksum de cada anexo e preferir ZIP para JSON nesse fluxo já ensaiado. Erro conclusivo de validação pode receber uma nova tentativa corrigida e registrada. Timeout/resultado incerto não autoriza reenvio automático. Não registrar chaves de envio ou dados pessoais desnecessários no Git.
