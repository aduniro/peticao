# Acessos atuais — três máquinas e acompanhamento móvel

## Execução de comandos

Os seis sentidos entre local, Santiago e São Paulo foram testados em IPv4 e IPv6, totalizando12 conexões sem senha. SSH não exige sudo. Para comandos administrativos usa-se `sudo -n`, sem senha nas VPSs. O sudo local de barre ainda depende do comando do proprietário indicado abaixo.

| Alias em qualquer uma das três máquinas | Conta | IP Tailnet |
|---|---|---|
| cluster-local | barre |100.105.193.63|
| cluster-santiago | sonda |100.80.18.81|
| cluster-sp | adunir |100.109.6.122|

IPv6 explícito: aliases cluster-local-ipv6, cluster-santiago-ipv6 e cluster-sp-ipv6. Os listeners privados usam porta2223; 22 e2222 não foram alterados. Chaves privadas ficaram nas respectivas máquinas; somente as públicas foram transferidas. Na São Paulo, peticao segue como conta da aplicação com `/usr/sbin/nologin`; seu sudo foi concedido conforme pedido, mas o SSH administrativo usa adunir.

De qualquer diretório, na conta correspondente de uma das três máquinas:

```bash
/usr/bin/ssh cluster-local /usr/bin/hostname
/usr/bin/ssh cluster-santiago '/usr/bin/sudo -n /usr/bin/id -u'
/usr/bin/ssh cluster-sp-ipv6 /usr/bin/hostname
```

Sudo local pendente — executar uma vez nesta máquina:

```bash
/usr/bin/sudo /usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/grant-sudo.py barre
/usr/bin/sudo -n /usr/bin/id -u
```

O serviço SSH local já funciona sem root e Linger=yes já estava habilitado. Mais detalhes: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/ADMIN-MESH.md`.

## Acompanhamento sem execução de comandos

Com a Tailscale conectada, abrir http://100.80.18.81:8766/ ou http://[fd7a:115c:a1e0::3e2f:1252]:8766/.

| Dispositivo autorizado | IPv4 Tailnet | IPv6 Tailnet |
|---|---|---|
| a15galaxybb |100.74.222.59|fd7a:115c:a1e0::942f:de3c|
| TL10 |100.101.28.33|fd7a:115c:a1e0::6a2f:1c22|
| TL10 Haven |100.65.166.58|fd7a:115c:a1e0::1c2f:a63b|
| Haven TL10 Dell |100.119.96.97|fd7a:115c:a1e0::152f:6062|

Esses dispositivos receberam somente acesso à página e à API de status, não chaves de shell, sudo ou comandos. A página mostra a fila de Santiago separada do resumo do Vigia local. Percentuais e estimativas vêm dos registros reais do Vigia; a fila não determina o percentual do admin-v2. Cada tarefa mostra sua última atualização. Resumo sem renovação por120 segundos é marcado antigo. Sem o computador local, o dashboard/fila em Santiago continuam disponíveis, mas o resumo local deixa de ser renovado.

Exportador local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/vigia_export.py`. Timer local: `/home/barre/.config/systemd/user/admin-v2-vigia-export.timer`. Arquivo recebido: `/srv/admin-v2-coordinator/vigia-summary.json` em Santiago. Nenhum detalhe, log ou dado do banco de assinaturas é exportado.

Servidor e limites: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/DASHBOARD-SOMENTE-LEITURA.md`. IPs incluídos e HTTP IPv4/IPv6 validados; abertura visual diretamente no celular/TL10/Havens ainda não foi observada. O TL10 estava offline no inventário.
