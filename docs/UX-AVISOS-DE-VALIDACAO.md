# Avisos de validação do formulário

Requisitos aprovados pelo responsável em 06/11/2026. Aplicam-se aos formulários
de Servidor(a) e Apoiador(a), sem modificar os textos de privacidade ou as regras
de validação já definidas.

## Comportamento obrigatório

- Cada erro permanece visível logo abaixo do campo correspondente e marca o
  próprio controle com contorno vermelho. Campos inválidos mantêm o contorno
  vermelho mesmo quando recebem foco. Checkboxes inválidos recebem destaque
  acessível equivalente.
- Uma tentativa que devolva um ou vários erros abre **uma única** janela modal.
  Ela resume o problema e, quando houver mais de um, inclui os avisos relevantes;
  os avisos de cada campo continuam visíveis na página.
- O botão de correção usa “Corrigir” nos avisos gerais. Ao fechar a janela, a
  página rola até e foca o primeiro campo inválido na ordem visual do formulário.
- Erro de nome: usar exatamente “Confira a grafia e informe o seu nome completo.”
  Não explicar no aviso as regras internas de comparação, partículas ou
  quantidade de palavras.
- Erros de e-mail também abrem modal. Erros locais, validação remota e respostas
  da API mantêm o aviso sob o e-mail e seu contorno vermelho.
- Quando a instituição atende à condição regional já documentada no app,
  deixar desmarcada a declaração obrigatória da Amazônia Legal/faixa de fronteira
  exibe erro sob a caixa, contorno vermelho na caixa e modal único que explica
  que a declaração deve ser marcada.

## Revisão antes de publicar

Validar nome divergente nos formulários de Servidor e Apoiador; erros simultâneos
de dois ou mais campos; e-mail inválido; e a caixa regional obrigatória. Em cada
caso, confirmar mensagem curta, avisos sob os controles, bordas vermelhas,
apenas um modal e foco/rolagem para o primeiro campo inválido após “Corrigir”.
Também confirmar que o texto de privacidade e os valores válidos não mudaram.
