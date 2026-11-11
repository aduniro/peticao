# Gate de identidade da exportação

O freeze 09baddad058d5934fe72e0cd63f8dfe691901ce2 permanece preservado no Git e como fixture original. Ele não era suficiente para garantir que um build copiado correspondia à fonte aprovada.

A correção exige que o commit do resultado, o commit do perfil do build e o commit do manifesto fonte sejam exatamente 140ce6b98af23045849335693a82b426fdc9c826. Exige também igualdade integral de chaves e hashes entre o mapa do build e o manifesto de fontes pinado do perfil. Confere ainda SHA, tamanho e caminho regular canônico de cada fonte copiada. A admissão acontece antes de materializar qualquer runtime ou exportação; as verificações anteriores de bytes e assets continuam presentes.

Prova pura: seis casos autoconsistentes de commit antigo (resultado, perfil ou ambos), fonte omitida, fonte extra e conteúdo/hash trocados ultrapassam esse gate no código antigo, chegando a um sentinela que impede qualquer exportação. Os mesmos seis casos são recusados na revisão. Bytes alterados também são recusados. Um conjunto exato válido chega ao próximo gate, igualmente interrompido pelo sentinela. Nenhum runtime antigo, build real, PostgreSQL, aplicativo, HTTP ou instalação foi usado.

Foram executados 24 testes puros: dez originais e quatorze regressões dirigidas. infra_reviewed continua false. A Fase B está em checkpoint separado e continua sem launcher aprovado ou pino do novo runtime.
