import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";

export const metadata = { title: "Política de privacidade" };

export default function Privacidade() {
  return (
    <>
    <AppBar />
    <main className="narrow">
      <h1>Política de privacidade</h1>
      <p className="small"><strong>Rascunho para revisão jurídica antes da publicação.</strong></p>
      <h2>Quem é responsável pelos dados</h2>
      <p>ADUNIR – Associação dos Docentes da Fundação Universidade Federal de Rondônia – Seção Sindical do ANDES-SN (CNPJ 15.883.671/0001-15), controladora dos dados. Encarregado: ADUNIR (contato a definir).</p>
      <h2>Quais dados coletamos e para quê</h2>
      <ul>
        <li><strong>Nome, categoria, instituição, campus ou cidade/UF (e, para estrangeiros, país e universidade):</strong> compõem a lista de apoiadores encaminhada às autoridades. A declaração de lotação na Amazônia Legal/Faixa de Fronteira e o idioma da tela servem a estatísticas internas.</li>
        <li><strong>E-mail:</strong> confirmar sua assinatura e evitar duplicidade. Não consta na lista enviada.</li>
        <li><strong>CPF (só Brasil; estrangeiros não informam CPF):</strong> guardado apenas como código irreversível (hash com segredo), para evitar assinaturas duplicadas e permitir conferência se você a pedir. Não consta na lista enviada.</li>
        <li><strong>IP, data/hora, navegador e versão do texto aceito:</strong> registrados como prova do seu aceite.</li>
      </ul>
      <h2>Verificações de segurança</h2>
      <ul>
        <li><strong>Confirmação de identidade (quem não usa e-mail institucional):</strong> pedimos a data de nascimento <em>ou</em> o nome da mãe e os comparamos com o cadastro do CPF consultado em um serviço de terceiros (cpf-brasil.org, ao qual enviamos o número do CPF). O que você digita e o que o cadastro devolve existem só na memória durante a conferência: <strong>não são gravados</strong> em banco de dados, arquivo de log nem cache. Guardamos apenas o CPF em hash, o método usado e se acertou, para limitar tentativas (máximo de 5 erros por CPF a cada 24 horas).</li>
        <li><strong>E-mail de universidade estrangeira:</strong> para estrangeiros, exigimos o e-mail institucional de uma universidade. Conferimos o domínio numa lista aberta de universidades (Hipo, licença MIT) e, se não constar, consultamos o domínio pela internet (DNS e página inicial) para ver se é uma instituição de ensino; essa consulta não envia dado pessoal. Domínios novos entram numa fila de revisão da ADUNIR.</li>
        <li><strong>E-mail institucional:</strong> verificamos se o domínio do seu e-mail pertence a um órgão ou instituição pública (ou de ensino superior) para exibir um selo informativo. O selo não comprova que você é servidor(a) e a ausência dele não impede a assinatura.</li>
        <li><strong>E-mail:</strong> conferimos se o domínio existe e recebe mensagens, e não aceitamos e-mails temporários. Não consultamos seu provedor sobre a caixa de entrada.</li>
        <li><strong>CPF e nome (opcional):</strong> se esta verificação estiver ativada, o CPF e o nome informados são enviados a um serviço de consulta para conferir se o nome confere com o cadastro. O resultado é só uma marca informativa: nunca impede a assinatura. Esta página será atualizada com o nome do provedor antes de ativá-la.</li>
      </ul>
      <h2>Lista pública de últimas assinaturas</h2>
      <p>A página inicial mostra, em tempo real, as últimas assinaturas confirmadas apenas com o <strong>primeiro nome</strong> (ex.: "Maria"), a bandeira (a do Brasil ou a do país de quem assina do exterior), o rótulo da categoria (sigla da IFES para servidores; "Apoiador da Sociedade Civil"; "Universidade Estrangeira") e há quanto tempo assinou. Nenhum outro dado aparece. Horários de registro seguem o horário de Brasília.</p>
      <h2>Página de contato</h2>
      <p>Ao usar o formulário de contato, guardamos o seu nome, e-mail, o assunto e a mensagem, além de um código irreversível do seu IP (limite de abusos), para responder a você. A mensagem também é enviada à caixa de contato da ADUNIR. Não envie CPF nem senhas.</p>
      <h2>Tour de ajuda</h2>
      <p>Para mostrar o tutorial só no primeiro acesso (ou depois de uma atualização do site), guardamos uma versão <strong>irreversível (hash)</strong> do seu endereço IP, a categoria do tour e a versão do site. Isso não identifica você e não é feito se o seu navegador enviar Do Not Track.</p>
      <h2>Botão "Escrever ao Governo"</h2>
      <p>O botão apenas abre o <strong>seu</strong> programa de e-mail com um texto pronto e os destinatários em cópia oculta. A mensagem sai do seu e-mail, não passa pelo nosso servidor, e nós não recebemos cópia.</p>
      <h2>Origem do acesso (links e QR codes de indicação)</h2>
      <p>Cada pessoa que confirma a assinatura recebe um link e um QR code próprios. Guardamos, junto de cada assinatura, de qual link ou QR ela chegou (do primeiro link aberto), para a ADUNIR entender como a campanha se espalhou. Quem indica vê apenas totais, nunca nomes. Guardamos também o nome, o e-mail e, quando o e-mail é institucional, o domínio e o nome da instituição correspondente.</p>
      <h2>Acessos ao site</h2>
      <p>Para entender de onde vêm os acessos e se o link de indicação funciona, registramos, com um cookie próprio (<code>vid</code>, 1 ano) e outro de indicação (<code>ref</code>, 30 dias): data e hora, páginas visitadas, cliques, endereço IP (IPv4/IPv6), localização aproximada pelo IP (cidade, estado, país, em base offline), provedor de internet, sistema operacional, navegador e tipo de aparelho.
        Esses registros só aparecem para a equipe da ADUNIR, são apagados após {process.env.EVENT_RETENTION_DAYS ?? 90} dias e <strong>não são registrados se o seu navegador enviar Do Not Track ou Global Privacy Control</strong>. Quem indica a petição vê apenas totais (quantos acessaram e assinaram), nunca nomes.</p>
      <h2>Base legal</h2>
      <p>Consentimento (LGPD, art. 7º, I), manifestado ao marcar a caixa de concordância. A petição pode revelar opinião política, dado sensível (art. 11, I); por isso o consentimento é específico e destacado.</p>
      <h2>Compartilhamento</h2>
      <p>A lista (nome, categoria, instituição ou cidade) é enviada à Presidência da República, à Casa Civil, ao MGI e a outros órgãos competentes. Não vendemos nem cedemos dados a terceiros para outros fins. Usamos provedores de hospedagem e envio de e-mail como operadores.</p>
      <h2>Por quanto tempo</h2>
      <p>Até o encerramento do processo de sanção e a entrega do dossiê final, mais o prazo necessário para comprovação (a definir), quando os dados serão eliminados ou anonimizados.</p>
      <h2>Seus direitos</h2>
      <p>Você pode pedir acesso, correção, exclusão e revogação do consentimento a qualquer momento, pelo contato do encarregado.</p>
      <p><a href="/">Voltar à petição</a></p>
      <h2>Verificação pública da assinatura</h2>
      <p>Cada assinatura confirmada recebe um número e um código de verificação. O código vai impresso, com um QR Code, na lista enviada às autoridades e abre uma página pública que mostra apenas: número, <strong>nome completo</strong>, instituição (ou cidade/UF), cargo e local de lotação (só de servidores da educação federal na Amazônia Legal/Faixa de Fronteira), data e hora da confirmação e se o CPF foi conferido com o nome. <strong>CPF, e-mail, data de nascimento e nome da mãe nunca aparecem.</strong></p>
      <h2>Segurança contra e-mails inexistentes e abuso</h2>
      <p>Quando um e-mail informado não existe, registramos a tentativa (com um código irreversível do e-mail e o seu IP). Três tentativas com o mesmo e-mail inexistente o colocam numa lista de bloqueio (o IP não é bloqueado). Guardamos também, por até {process.env.EVENT_RETENTION_DAYS ?? 90} dias, o IP, a localização aproximada (base offline) e o tipo de ocorrência (assinatura aguardando ou confirmada, e-mail inexistente, bloqueio) para o painel de monitoramento da ADUNIR. E-mails que não puderem ser enviados por falha do serviço ficam numa fila e são reenviados automaticamente por até 48 horas.</p>
    </main>
    <SiteFooter />
    </>
  );
}