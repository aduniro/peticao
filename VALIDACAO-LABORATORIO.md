# Validação do laboratório —08/11/2026

Cópia A da captura VPS e cópia B do candidato da2c354, em branches/worktree
independentes do desenvolvimento original. Nenhuma modificação nas fontes das
aplicações após o congelamento. Backup original revalidado por SHA-256 e Git.

## Resultado final

- Builds de A e B aprovados, incluindo verificação de tipos do Next.
- B:199/199 testes, zero falhas, cancelamentos ou ignorados; log reports/unit-b.log.
- A:173 testes na bateria herdada,164 aprovados e9 falhas. O auxiliar externo
  ausente foi disponibilizado e passou em4/4 testes dirigidos;8 expectativas
  herdadas permanecem divergentes. Não alteramos A nem seus testes para apagá-las.
  Evidências em reports/baseline-unit-failures.json e unit-targeted-a.log.
-24 cenários de navegador aprovados, zero erros de execução: três formulários,
  validação de campo/foco, único modal, troca de categoria, falha de fetch,
  correção de campus, CPF/nome, identidade, antirrobô e envio de estrangeiro.
-22 pares de capturas nas larguras390/768/1440px e controle adicional de foco
  com altura1600px.17 pares idênticos. Diferenças restantes: portas nos links,
  sobreposição do fechar e3 pixels na borda de um recorte. Imagens brutas mantidas;
  classificações revisadas ficam presas aos hashes em reports/visual-review.json.
  Capturas futuras diferentes não herdam automaticamente essas classificações.
- Esquema público dos dois bancos fictícios idêntico, pg_dump comparado.
-3 testes de isolamento/fidelidade e2 do simulador de rede aprovados.
- Comando parar/iniciar validado; somente os quatro contêineres do laboratório
  e seu proxy foram controlados. Prévia3031, revisão8765 e contêineres do espelho
  permaneceram com os mesmos processos. Nenhum serviço da VPS foi operado.
- As duas instâncias foram deixadas em HTTP200 com os mesmos quatro exemplos
  fictícios, prontas para revisão manual. Nenhum banco real foi restaurado nelas.

## Observações encontradas e preservadas

A reproduz o falso sucesso do honeypot preenchido; B rejeita a falha de segurança
sem apagar o formulário. No caminho normal, com honeypot vazio, o antirrobô
recusado continua com aviso inline nas duas versões. Não incluímos outro modal.

A preparação inicial teve falhas do harness: painel móvel fechado, popovers de
UF/cidade interceptando cliques, tentativa de reutilizar formulário após sucesso,
auxiliar de testes relativo ao diretório pai e caixa dev sem acesso de escrita.
Os roteiros/ambiente foram corrigidos, sem mudar os formulários. Primeiras
execuções e seus logs permanecem em runtime/. Nenhum resultado falho foi
convertido em aprovação sem uma nova execução correspondente.

O helper de ponte provém do repositório local, com mesma cópia para A/B; existe
somente como dependência de teste. A imagem cria o vínculo/site→/app para manter
os imports relativos desses testes. O processo de produção original não depende
desse helper. Os contêineres só têm configurações/chaves fictícias; testes unitários
usam qa_unit, separado do banco de revisão manual do laboratório.

Relatório HTML: reports/index.html. Resumo estruturado: reports/delivery.json.
Ainda não houve deploy, merge ou correção do aplicativo; os próximos ajustes
visuais devem ser escolhidos depois da revisão do proprietário.
