# Recuperação do antirobô sem sucesso aparente

Implementação autorizada em08/11/2026, alternativa2. Candidato isolado a partir de
61edd21. Comparação com captura somente leitura da produção:680 arquivos; as sete
diferenças são testes, nenhum código de execução difere. Não publicar nem mesclar
com a VPS. Preservar o desenvolvimento admin-v2 no outro worktree.

O campo oculto preenchido será sinal auxiliar, combinado com Turnstile validado
no servidor. Validações de campo, domínio/categoria, CPF, identidade, duplicidade
e limites existentes continuam obrigatórias. Falha de segurança retorna erro
recuperável; não cria cadastro, não envia e-mail nem apaga campos visíveis.

Reutilizar a verificação apenas dentro da mesma requisição. Para a segunda etapa
legítima de identidade, transportar prova assinada e limitada ao ticket/input,
sem reutilizar token Turnstile já consumido nem persistir dados adicionais.

Texto aprovado: “Não foi possível concluir a verificação de segurança. Seus dados
foram mantidos. Tente novamente.” Somente esse novo erro e traduções equivalentes;
não alterar estilos, outros textos, avisos de privacidade, cache ou regras CPF.

Regressões: campo oculto vazio/preenchido; Turnstile válido, inválido, reutilizado,
expirado, indisponível/desativado; erro no campus e nova tentativa; identidade em
duas etapas sem consumir o mesmo token duas vezes; domínio não federal rejeitado
em Servidor; dados preservados; nenhuma gravação ou envio em recusas; três abas.

O domínio sou.ucpel.edu.br pertence à Universidade Católica de Pelotas, comunitária,
não federal. Na produção ele está pending/outro e não aprovado como IFES. O sufixo
edu.br não identifica uma instituição federal. Não aprovar domínio automaticamente.
Fonte oficial: https://ucpel.edu.br/noticias/ucpel-e-requalificada-como-instituicao-comunitaria-pelo-mec
