import { createHash } from "node:crypto";
import type { Locale } from "@/i18n";

export type Doc = {
  title: string; recipient: string; copies: string; salutation: string; intro: string[];
  reasonsTitle: string; reasons: string[]; requestTitle: string; request: string; closing: string; signedBy: string; consentBr: string; consentForeign: string;
};

export const ORGANIZER = "ADUNIR – Associação dos Docentes da Fundação Universidade Federal de Rondônia – Seção Sindical do ANDES-SN (CNPJ 15.883.671/0001-15)";

/* ===================== Texto brasileiro (servidores e apoiadores) ===================== */
const BR: Record<Locale, Doc> = {
  pt: {
    title: "Pela Sanção Integral do PLV nº 12/2026: Valorização dos Servidores das IFES em todos os Campi situados na Amazônia Legal e na Faixa de Fronteira",
    recipient: "Excelentíssimo Senhor Presidente da República, Luiz Inácio Lula da Silva",
    copies: "Casa Civil da Presidência da República; Ministério da Gestão e da Inovação em Serviços Públicos (MGI); Ministério da Educação (MEC)",
    salutation: "Excelentíssimo Senhor Presidente da República,",
    intro: [
      "Os professores e técnicos-administrativos das Universidades e Institutos Federais, suas entidades representativas e a sociedade civil organizada solicitam a SANÇÃO INTEGRAL do Projeto de Lei de Conversão (PLV) nº 12/2026, aprovado pelo Congresso Nacional, com especial atenção à inclusão dos servidores da educação federal na Indenização de Localidades Estratégicas (ILE), em todos os Campi situados na Amazônia Legal e na Faixa de Fronteira.",
      "Esta manifestação é feita no exercício do direito de petição (Constituição Federal, art. 5º, XXXIV, \"a\"). O projeto foi aprovado pela Câmara dos Deputados em 27 de outubro de 2026 e pelo Senado Federal em 28 de outubro de 2026, e aguarda sanção.",
      "Originário da Medida Provisória nº 1.375/2026, o projeto representa um avanço na valorização de quem mantém a educação pública na Amazônia Legal, na faixa de fronteira e em localidades de difícil provimento. O adicional de R$ 191,00 por dia de efetivo trabalho corrige uma defasagem de mais de uma década (valor mantido em R$ 91,00 desde a Lei nº 12.855/2013) e fortalece a atração e a permanência de profissionais nessas regiões.",
      "Atuar no interior, em áreas isoladas e de difícil acesso, impõe enormes desafios e elevado custo de vida. A inclusão das carreiras do magistério federal e dos técnicos-administrativos em educação corrige uma injustiça histórica e assegura tratamento isonômico aos servidores que trabalham nas mesmas localidades estratégicas.",
      "Cabe ao Ministério da Gestão e da Inovação em Serviços Públicos (MGI) definir, por ato próprio e em relação única, os Municípios que serão considerados localidades estratégicas. Por isso, esta petição também é um apelo ao MGI: que adote um critério que contemple todos os Campi das Instituições Federais de Ensino situados na Amazônia Legal e na Faixa de Fronteira, para que nenhum servidor dessas regiões fique de fora do benefício.",
      "Essa valorização é essencial para manter universidades e institutos abertos com dignidade, assegurar a continuidade do ensino, da pesquisa e da extensão e ampliar as oportunidades das populações atendidas. Fortalecer essas instituições significa fortalecer a presença do Estado e o desenvolvimento regional.",
      "Presidente Lula, contamos com seu apoio a quem está na linha de frente pela democracia e por um Brasil mais justo, forte e soberano. Sancione integralmente o PLV nº 12/2026, sem vetos à educação federal.",
    ],
    reasonsTitle: "Por que pedimos a sanção integral",
    reasons: [
      "**Reconhece quem sustenta a educação federal nas regiões mais remotas.** O PLV inclui os integrantes do Plano de Carreiras e Cargos de Magistério Federal (Lei nº 12.772/2012) e os técnico-administrativos em educação (Lei nº 11.091/2005), em exercício nas instituições federais de ensino vinculadas ao Ministério da Educação, entre os beneficiários da indenização de localidades estratégicas da Lei nº 12.855/2013 (art. 1º, § 1º, XIX, na redação dada pelo projeto).",
      "**Trata docentes e técnicos de forma igual no mesmo lugar.** O texto prevê que, reconhecido o município como localidade estratégica, a indenização é devida a todos os servidores das carreiras relacionadas em exercício nele, vedado tratamento diferenciado entre órgãos ou entidades quanto à mesma localidade.",
      "**Usa critérios objetivos para as localidades.** Os municípios serão definidos em relação única, por ato do MGI, considerando a região de fronteira, a Amazônia Legal e a dificuldade de fixação de efetivo, com divulgação em meio eletrônico de acesso público. É indispensável que o MGI aplique esses critérios de modo a alcançar todos os Campi situados nessas áreas.",
      "**Facilita a fixação de servidores vindos de outros estados.** Aplicada a todos os Campi da Amazônia Legal, a indenização ajuda a atrair e a manter na região servidores oriundos de outros estados, de fora da Amazônia, que se mudam para trabalhar longe de suas famílias e redes de apoio.",
      "**Ajuda a atrair e manter servidores onde há dificuldade de fixação.** A indenização passa a R$ 191,00 por dia de efetivo trabalho, com efeitos financeiros a partir de 1º de janeiro de 2027. Isso favorece a permanência de docentes e técnicos que mantêm cursos, pesquisa e extensão em regiões distantes dos grandes centros.",
      "**Fortalece o desenvolvimento regional.** As universidades e institutos federais na Amazônia Legal e na Faixa de Fronteira formam profissionais, produzem conhecimento e levam o Estado brasileiro a territórios onde ele é menos presente.",
    ],
    requestTitle: "Pedido",
    request: "Requeremos a Vossa Excelência a **sanção integral do PLV nº 12/2026**, preservando em especial a inclusão dos servidores das Instituições Federais de Ensino na Indenização de Localidades Estratégicas, e a adoção de um critério pelo MGI que contemple todos os Campi situados na Amazônia Legal e na Faixa de Fronteira.",
    closing: "Respeitosamente,",
    signedBy: "Servidores das Instituições Federais de Ensino Superior, suas entidades representativas e sociedade civil organizada.",
    consentBr: "Li o texto da petição e concordo com ele. Autorizo a ADUNIR a incluir meu nome, categoria e instituição ou cidade na lista encaminhada às autoridades e a exibir meu primeiro nome na lista pública de últimas assinaturas do site.",
    consentForeign: "Li o texto da petição e concordo com ele. Autorizo a ADUNIR a incluir meu nome, país e universidade na lista encaminhada às autoridades e a exibir meu primeiro nome (com a bandeira do meu país) na lista pública de últimas assinaturas do site.",
  },
  en: {
    title: "For the Full Sanction of PLV No. 12/2026: Valuing Federal Higher-Education Staff at All Campuses in the Legal Amazon and the Border Strip",
    recipient: "His Excellency the President of the Republic, Luiz Inácio Lula da Silva",
    copies: "Civil House of the Presidency; Ministry of Management and Innovation in Public Services (MGI); Ministry of Education (MEC)",
    salutation: "Your Excellency the President of the Republic,",
    intro: [
      "The professors and technical-administrative staff of the Federal Universities and Institutes, their representative bodies and organized civil society request the FULL SANCTION of Conversion Bill (PLV) No. 12/2026, approved by the National Congress, with special attention to the inclusion of federal education staff in the Strategic Locations Allowance (ILE), at all campuses located in the Legal Amazon and the Border Strip.",
      "This statement is made in the exercise of the right of petition (Federal Constitution, art. 5, XXXIV, \"a\"). The bill was approved by the Chamber of Deputies on 27 October 2026 and by the Federal Senate on 28 October 2026, and awaits sanction.",
      "Originating from Provisional Measure No. 1,375/2026, the bill is a step forward in valuing those who sustain public education in the Legal Amazon, in the border strip and in hard-to-staff locations. The allowance of R$ 191.00 per day of effective work corrects a gap of more than a decade (the amount has stayed at R$ 91.00 since Law No. 12,855/2013) and strengthens the attraction and retention of professionals in these regions.",
      "Working in the interior, in isolated and hard-to-reach areas, brings enormous challenges and a high cost of living. Including the federal teaching careers and the technical-administrative education staff corrects a historical injustice and ensures equal treatment for staff working in the same strategic locations.",
      "It is for the Ministry of Management and Innovation in Public Services (MGI) to define, by its own act and in a single list, the Municipalities that will be considered strategic locations. This petition is therefore also an appeal to the MGI: to adopt a criterion that covers all campuses of Federal Educational Institutions located in the Legal Amazon and the Border Strip, so that no staff member in these regions is left out of the benefit.",
      "This recognition is essential to keep universities and institutes open with dignity, to ensure the continuity of teaching, research and outreach, and to widen opportunities for the populations they serve. Strengthening these institutions means strengthening the presence of the State and regional development.",
      "President Lula, we count on your support for those on the front line for democracy and for a fairer, stronger and sovereign Brazil. Fully sanction PLV No. 12/2026, without vetoes to federal education.",
    ],
    reasonsTitle: "Why we ask for full sanction",
    reasons: [
      "**It recognizes those who sustain federal education in the most remote regions.** The PLV includes members of the Federal Teaching Career Plan (Law No. 12,772/2012) and the technical-administrative education staff (Law No. 11,091/2005) working at federal institutions linked to the Ministry of Education among the beneficiaries of the strategic locations allowance of Law No. 12,855/2013 (art. 1, § 1, XIX, as worded by the bill).",
      "**It treats faculty and technical staff equally in the same place.** The text provides that, once a municipality is recognized as a strategic location, the allowance is due to all staff of the listed careers working there, with no differentiated treatment between bodies or entities for the same location.",
      "**It uses objective criteria for locations.** Municipalities will be defined in a single list, by act of the MGI, considering the border region, the Legal Amazon and the difficulty of retaining staff, published electronically for the public. It is essential that the MGI apply these criteria so as to reach all campuses located in these areas.",
      "**It makes it easier to retain staff from other states.** Applied to all campuses in the Legal Amazon, the allowance helps attract and keep in the region staff from other states, from outside the Amazon, who relocate to work far from their families and support networks.",
      "**It helps attract and keep staff where retention is difficult.** The allowance becomes R$ 191.00 per day of effective work, with financial effects from 1 January 2027. This favors the permanence of faculty and technical staff who sustain teaching, research and outreach in regions far from major centers.",
      "**It strengthens regional development.** Federal universities and institutes in the Legal Amazon and the Border Strip train professionals, produce knowledge and bring the Brazilian State to territories where it is less present.",
    ],
    requestTitle: "Request",
    request: "We request Your Excellency the **full sanction of PLV No. 12/2026**, preserving in particular the inclusion of staff of Federal Educational Institutions in the Strategic Locations Allowance, and the adoption by the MGI of a criterion that covers all campuses located in the Legal Amazon and the Border Strip.",
    closing: "Respectfully,",
    signedBy: "Staff of Federal Higher-Education Institutions, their representative bodies and organized civil society.",
    consentBr: "I have read the petition and agree with it. I authorize ADUNIR to include my name, category and institution or city in the list sent to the authorities and to show my first name in the public list of latest signatures on the site.",
    consentForeign: "I have read the petition and agree with it. I authorize ADUNIR to include my name, country and university in the list sent to the authorities and to show my first name (with my country's flag) in the public list of latest signatures on the site.",
  },
  es: {
    title: "Por la Sanción Íntegra del PLV n.º 12/2026: Valoración del Personal de las IFES en todos los Campus situados en la Amazonía Legal y en la Franja de Frontera",
    recipient: "Excelentísimo Señor Presidente de la República, Luiz Inácio Lula da Silva",
    copies: "Casa Civil de la Presidencia; Ministerio de Gestión e Innovación en Servicios Públicos (MGI); Ministerio de Educación (MEC)",
    salutation: "Excelentísimo Señor Presidente de la República:",
    intro: [
      "Los profesores y técnicos-administrativos de las Universidades e Institutos Federales, sus entidades representativas y la sociedad civil organizada solicitan la SANCIÓN ÍNTEGRA del Proyecto de Ley de Conversión (PLV) n.º 12/2026, aprobado por el Congreso Nacional, con especial atención a la inclusión del personal de la educación federal en la Indemnización de Localidades Estratégicas (ILE), en todos los Campus situados en la Amazonía Legal y en la Franja de Frontera.",
      "Esta manifestación se realiza en ejercicio del derecho de petición (Constitución Federal, art. 5, XXXIV, \"a\"). El proyecto fue aprobado por la Cámara de Diputados el 27 de octubre de 2026 y por el Senado Federal el 28 de octubre de 2026, y aguarda sanción.",
      "Originado en la Medida Provisional n.º 1.375/2026, el proyecto representa un avance en la valoración de quienes sostienen la educación pública en la Amazonía Legal, en la franja de frontera y en localidades de difícil provisión. El adicional de R$ 191,00 por día de trabajo efectivo corrige un rezago de más de una década (valor mantenido en R$ 91,00 desde la Ley n.º 12.855/2013) y fortalece la atracción y la permanencia de profesionales en esas regiones.",
      "Trabajar en el interior, en áreas aisladas y de difícil acceso, impone enormes desafíos y un alto costo de vida. La inclusión de las carreras del magisterio federal y de los técnicos-administrativos en educación corrige una injusticia histórica y asegura trato igualitario al personal que trabaja en las mismas localidades estratégicas.",
      "Corresponde al Ministerio de Gestión e Innovación en Servicios Públicos (MGI) definir, mediante acto propio y en una relación única, los Municipios que serán considerados localidades estratégicas. Por ello, esta petición es también un llamado al MGI: que adopte un criterio que abarque todos los Campus de las Instituciones Federales de Enseñanza situados en la Amazonía Legal y en la Franja de Frontera, para que ningún trabajador de esas regiones quede fuera del beneficio.",
      "Esta valoración es esencial para mantener las universidades y los institutos abiertos con dignidad, asegurar la continuidad de la enseñanza, la investigación y la extensión, y ampliar las oportunidades de las poblaciones atendidas. Fortalecer esas instituciones significa fortalecer la presencia del Estado y el desarrollo regional.",
      "Presidente Lula, contamos con su apoyo a quienes están en la primera línea por la democracia y por un Brasil más justo, fuerte y soberano. Sancione íntegramente el PLV n.º 12/2026, sin vetos a la educación federal.",
    ],
    reasonsTitle: "Por qué pedimos la sanción íntegra",
    reasons: [
      "**Reconoce a quienes sostienen la educación federal en las regiones más remotas.** El PLV incluye a los integrantes del Plan de Carreras y Cargos del Magisterio Federal (Ley n.º 12.772/2012) y a los técnico-administrativos en educación (Ley n.º 11.091/2005), en ejercicio en las instituciones federales de enseñanza vinculadas al Ministerio de Educación, entre los beneficiarios de la indemnización de localidades estratégicas de la Ley n.º 12.855/2013 (art. 1, § 1, XIX, en la redacción dada por el proyecto).",
      "**Trata por igual a docentes y técnicos en el mismo lugar.** El texto prevé que, reconocido el municipio como localidad estratégica, la indemnización es debida a todos los servidores de las carreras relacionadas en ejercicio en él, vedado el trato diferenciado entre órganos o entidades en una misma localidad.",
      "**Usa criterios objetivos para las localidades.** Los municipios serán definidos en una relación única, por acto del MGI, considerando la región de frontera, la Amazonía Legal y la dificultad de fijar personal, con divulgación en medio electrónico de acceso público. Es indispensable que el MGI aplique esos criterios de modo que alcancen todos los Campus situados en esas áreas.",
      "**Facilita la permanencia de personal venido de otros estados.** Aplicada a todos los Campus de la Amazonía Legal, la indemnización ayuda a atraer y mantener en la región a servidores de otros estados, de fuera de la Amazonía, que se mudan para trabajar lejos de sus familias y redes de apoyo.",
      "**Ayuda a atraer y mantener personal donde hay dificultad de fijación.** La indemnización pasa a R$ 191,00 por día de trabajo efectivo, con efectos financieros desde el 1 de enero de 2027. Esto favorece la permanencia de docentes y técnicos que sostienen cursos, investigación y extensión en regiones alejadas de los grandes centros.",
      "**Fortalece el desarrollo regional.** Las universidades e institutos federales en la Amazonía Legal y en la Franja de Frontera forman profesionales, producen conocimiento y llevan el Estado brasileño a territorios donde está menos presente.",
    ],
    requestTitle: "Petición",
    request: "Solicitamos a Vuestra Excelencia la **sanción íntegra del PLV n.º 12/2026**, preservando en especial la inclusión del personal de las Instituciones Federales de Enseñanza en la Indemnización de Localidades Estratégicas, y la adopción por parte del MGI de un criterio que abarque todos los Campus situados en la Amazonía Legal y en la Franja de Frontera.",
    closing: "Respetuosamente,",
    signedBy: "Personal de las Instituciones Federales de Educación Superior, sus entidades representativas y sociedad civil organizada.",
    consentBr: "He leído el texto de la petición y estoy de acuerdo. Autorizo a ADUNIR a incluir mi nombre, categoría e institución o ciudad en la lista enviada a las autoridades y a mostrar mi nombre de pila en la lista pública de últimas firmas del sitio.",
    consentForeign: "He leído el texto de la petición y estoy de acuerdo. Autorizo a ADUNIR a incluir mi nombre, país y universidad en la lista enviada a las autoridades y a mostrar mi nombre de pila (con la bandera de mi país) en la lista pública de últimas firmas del sitio.",
  },
  fr: {
    title: "Pour la Sanction Intégrale du PLV n° 12/2026 : Valorisation des Personnels des IFES dans tous les Campus situés en Amazonie légale et dans la Zone frontalière",
    recipient: "Son Excellence Monsieur le Président de la République, Luiz Inácio Lula da Silva",
    copies: "Casa Civil de la Présidence ; Ministère de la Gestion et de l'Innovation dans les Services Publics (MGI) ; Ministère de l'Éducation (MEC)",
    salutation: "Excellentissime Monsieur le Président de la République,",
    intro: [
      "Les enseignants et personnels techniques et administratifs des Universités et Instituts fédéraux, leurs organisations représentatives et la société civile organisée demandent la SANCTION INTÉGRALE du Projet de loi de conversion (PLV) n° 12/2026, approuvé par le Congrès national, avec une attention particulière à l'inclusion des personnels de l'éducation fédérale dans l'Indemnité de Localités Stratégiques (ILE), dans tous les Campus situés en Amazonie légale et dans la Zone frontalière.",
      "Cette démarche est faite dans l'exercice du droit de pétition (Constitution fédérale, art. 5, XXXIV, « a »). Le projet a été approuvé par la Chambre des députés le 27 octobre 2026 et par le Sénat fédéral le 28 octobre 2026, et attend la sanction.",
      "Issu de la Mesure provisoire n° 1.375/2026, le projet marque une avancée dans la valorisation de ceux qui font vivre l'éducation publique en Amazonie légale, dans la zone frontalière et dans les localités difficiles à pourvoir. Le complément de 191,00 R$ par jour de travail effectif corrige un retard de plus d'une décennie (montant maintenu à 91,00 R$ depuis la Loi n° 12.855/2013) et renforce l'attractivité et la fidélisation des professionnels dans ces régions.",
      "Travailler à l'intérieur du pays, dans des zones isolées et difficiles d'accès, impose d'énormes défis et un coût de la vie élevé. L'inclusion des carrières de l'enseignement fédéral et des personnels techniques et administratifs de l'éducation corrige une injustice historique et assure un traitement égal aux agents qui travaillent dans les mêmes localités stratégiques.",
      "Il revient au Ministère de la Gestion et de l'Innovation dans les Services Publics (MGI) de définir, par acte propre et dans une liste unique, les Communes qui seront considérées comme localités stratégiques. Cette pétition est donc aussi un appel au MGI : qu'il adopte un critère couvrant tous les Campus des Établissements fédéraux d'enseignement situés en Amazonie légale et dans la Zone frontalière, afin qu'aucun agent de ces régions ne soit exclu du bénéfice.",
      "Cette valorisation est essentielle pour maintenir les universités et instituts ouverts dans la dignité, assurer la continuité de l'enseignement, de la recherche et de l'extension, et élargir les opportunités des populations desservies. Renforcer ces institutions, c'est renforcer la présence de l'État et le développement régional.",
      "Monsieur le Président Lula, nous comptons sur votre soutien à ceux qui sont en première ligne pour la démocratie et pour un Brésil plus juste, fort et souverain. Sanctionnez intégralement le PLV n° 12/2026, sans veto à l'éducation fédérale.",
    ],
    reasonsTitle: "Pourquoi nous demandons la sanction intégrale",
    reasons: [
      "**Il reconnaît ceux qui font vivre l'éducation fédérale dans les régions les plus reculées.** Le PLV inclut les membres du Plan de carrières du Magistère fédéral (Loi n° 12.772/2012) et les techniciens-administratifs de l'éducation (Loi n° 11.091/2005), en poste dans les établissements fédéraux liés au Ministère de l'Éducation, parmi les bénéficiaires de l'indemnité de localités stratégiques de la Loi n° 12.855/2013 (art. 1, § 1, XIX, dans la rédaction donnée par le projet).",
      "**Il traite enseignants et techniciens à égalité au même endroit.** Le texte prévoit que, une fois la commune reconnue comme localité stratégique, l'indemnité est due à tous les agents des carrières listées qui y exercent, tout traitement différencié entre organes ou entités pour une même localité étant interdit.",
      "**Il utilise des critères objectifs pour les localités.** Les communes seront définies dans une liste unique, par acte du MGI, en tenant compte de la région frontalière, de l'Amazonie légale et de la difficulté de fidéliser les effectifs, avec publication électronique accessible au public. Il est indispensable que le MGI applique ces critères de façon à couvrir tous les Campus situés dans ces zones.",
      "**Il facilite la fidélisation d'agents venus d'autres États.** Appliquée à tous les Campus d'Amazonie légale, l'indemnité aide à attirer et à garder dans la région des agents originaires d'autres États, hors d'Amazonie, qui déménagent pour travailler loin de leurs familles et de leurs réseaux de soutien.",
      "**Il aide à attirer et à garder des agents là où la fidélisation est difficile.** L'indemnité passe à 191,00 R$ par jour de travail effectif, avec effets financiers à partir du 1er janvier 2027. Cela favorise le maintien des enseignants et techniciens qui assurent cours, recherche et extension dans des régions éloignées des grands centres.",
      "**Il renforce le développement régional.** Les universités et instituts fédéraux d'Amazonie légale et de la Zone frontalière forment des professionnels, produisent des connaissances et portent l'État brésilien dans des territoires où il est moins présent.",
    ],
    requestTitle: "Demande",
    request: "Nous demandons à Votre Excellence la **sanction intégrale du PLV n° 12/2026**, en préservant en particulier l'inclusion des agents des Établissements fédéraux d'enseignement dans l'Indemnité de Localités Stratégiques, et l'adoption par le MGI d'un critère couvrant tous les Campus situés en Amazonie légale et dans la Zone frontalière.",
    closing: "Respectueusement,",
    signedBy: "Personnels des Établissements fédéraux d'enseignement supérieur, leurs organisations représentatives et société civile organisée.",
    consentBr: "J'ai lu le texte de la pétition et je suis d'accord. J'autorise l'ADUNIR à inclure mon nom, ma catégorie et mon établissement ou ma ville dans la liste transmise aux autorités et à afficher mon prénom dans la liste publique des dernières signatures du site.",
    consentForeign: "J'ai lu le texte de la pétition et je suis d'accord. J'autorise l'ADUNIR à inclure mon nom, mon pays et mon université dans la liste transmise aux autorités et à afficher mon prénom (avec le drapeau de mon pays) dans la liste publique des dernières signatures du site.",
  },
  de: {
    title: "Für die vollständige Inkraftsetzung des PLV Nr. 12/2026: Aufwertung der Beschäftigten der IFES an allen Campus im Legalen Amazonasgebiet und im Grenzstreifen",
    recipient: "Seine Exzellenz den Präsidenten der Republik, Luiz Inácio Lula da Silva",
    copies: "Casa Civil des Präsidialamts; Ministerium für Verwaltung und Innovation im öffentlichen Dienst (MGI); Bildungsministerium (MEC)",
    salutation: "Sehr geehrter Herr Präsident der Republik,",
    intro: [
      "Die Professorinnen, Professoren und das technisch-administrative Personal der Bundesuniversitäten und -institute, ihre Interessenvertretungen und die organisierte Zivilgesellschaft bitten um die VOLLSTÄNDIGE SANKTIONIERUNG des Umwandlungsgesetzentwurfs (PLV) Nr. 12/2026, vom Nationalkongress verabschiedet, mit besonderem Augenmerk auf die Einbeziehung der Beschäftigten der Bundesbildung in die Zulage für strategische Standorte (ILE), an allen Campus im Legalen Amazonasgebiet und im Grenzstreifen.",
      "Diese Erklärung erfolgt in Ausübung des Petitionsrechts (Bundesverfassung, Art. 5, XXXIV, „a“). Der Entwurf wurde am 27. Oktober 2026 vom Abgeordnetenhaus und am 28. Oktober 2026 vom Bundessenat verabschiedet und wartet auf die Sanktionierung.",
      "Der aus der Vorläufigen Maßnahme Nr. 1.375/2026 hervorgegangene Entwurf ist ein Fortschritt bei der Wertschätzung derer, die die öffentliche Bildung im Legalen Amazonasgebiet, im Grenzstreifen und an schwer zu besetzenden Standorten tragen. Die Zulage von R$ 191,00 pro tatsächlichem Arbeitstag behebt einen Rückstand von mehr als einem Jahrzehnt (der Betrag blieb seit dem Gesetz Nr. 12.855/2013 bei R$ 91,00) und stärkt Gewinnung und Verbleib von Fachkräften in diesen Regionen.",
      "Die Arbeit im Landesinneren, in abgelegenen und schwer erreichbaren Gebieten, bringt enorme Herausforderungen und hohe Lebenshaltungskosten mit sich. Die Einbeziehung der Bundeslehrlaufbahnen und des technisch-administrativen Bildungspersonals behebt ein historisches Unrecht und sichert Gleichbehandlung der Beschäftigten an denselben strategischen Standorten.",
      "Es obliegt dem Ministerium für Verwaltung und Innovation im öffentlichen Dienst (MGI), durch eigenen Akt und in einer einheitlichen Liste die Gemeinden festzulegen, die als strategische Standorte gelten. Diese Petition ist daher auch ein Appell an das MGI: ein Kriterium zu wählen, das alle Campus der Bundesbildungseinrichtungen im Legalen Amazonasgebiet und im Grenzstreifen erfasst, damit kein Beschäftigter dieser Regionen vom Vorteil ausgeschlossen wird.",
      "Diese Aufwertung ist wesentlich, um Universitäten und Institute würdig offen zu halten, die Kontinuität von Lehre, Forschung und Transfer zu sichern und die Chancen der betreuten Bevölkerung zu erweitern. Diese Einrichtungen zu stärken heißt, die Präsenz des Staates und die regionale Entwicklung zu stärken.",
      "Präsident Lula, wir zählen auf Ihre Unterstützung für diejenigen, die an vorderster Front für Demokratie und für ein gerechteres, stärkeres und souveränes Brasilien stehen. Setzen Sie das PLV Nr. 12/2026 vollständig in Kraft, ohne Vetos gegen die Bundesbildung.",
    ],
    reasonsTitle: "Warum wir die vollständige Sanktionierung fordern",
    reasons: [
      "**Er erkennt an, wer die Bundesbildung in den entlegensten Regionen trägt.** Das PLV nimmt die Angehörigen des Karriereplans der Bundeslehrkräfte (Gesetz Nr. 12.772/2012) und das technisch-administrative Bildungspersonal (Gesetz Nr. 11.091/2005) der dem Bildungsministerium zugeordneten Bundeseinrichtungen in den Kreis der Begünstigten der Zulage für strategische Standorte des Gesetzes Nr. 12.855/2013 auf (Art. 1, § 1, XIX, in der Fassung des Entwurfs).",
      "**Er behandelt Lehrende und technisches Personal am selben Ort gleich.** Der Text sieht vor, dass die Zulage, sobald die Gemeinde als strategischer Standort anerkannt ist, allen dort tätigen Beschäftigten der genannten Laufbahnen zusteht; eine unterschiedliche Behandlung zwischen Organen oder Einrichtungen am selben Standort ist untersagt.",
      "**Er verwendet objektive Kriterien für die Standorte.** Die Gemeinden werden in einer einheitlichen Liste per Akt des MGI festgelegt, unter Berücksichtigung der Grenzregion, des Legalen Amazonasgebiets und der Schwierigkeit, Personal zu halten, mit elektronischer öffentlicher Bekanntmachung. Es ist unerlässlich, dass das MGI diese Kriterien so anwendet, dass alle Campus in diesen Gebieten erfasst werden.",
      "**Er erleichtert den Verbleib von Personal aus anderen Bundesstaaten.** Auf alle Campus im Legalen Amazonasgebiet angewandt, hilft die Zulage, Beschäftigte aus anderen Bundesstaaten außerhalb Amazoniens in die Region zu holen und dort zu halten, die fern von Familie und Unterstützungsnetz arbeiten.",
      "**Er hilft, Personal dort zu gewinnen und zu halten, wo der Verbleib schwierig ist.** Die Zulage steigt auf R$ 191,00 pro tatsächlichem Arbeitstag, mit finanzieller Wirkung ab dem 1. Januar 2027. Das begünstigt den Verbleib von Lehrenden und Technikern, die Lehre, Forschung und Transfer in Regionen fern der Zentren tragen.",
      "**Er stärkt die regionale Entwicklung.** Die Bundesuniversitäten und -institute im Legalen Amazonasgebiet und im Grenzstreifen bilden Fachkräfte aus, schaffen Wissen und bringen den brasilianischen Staat in Gebiete, in denen er weniger präsent ist.",
    ],
    requestTitle: "Ersuchen",
    request: "Wir ersuchen Eure Exzellenz um die **vollständige Sanktionierung des PLV Nr. 12/2026**, unter besonderer Wahrung der Einbeziehung der Beschäftigten der Bundesbildungseinrichtungen in die Zulage für strategische Standorte, sowie um die Wahl eines Kriteriums durch das MGI, das alle Campus im Legalen Amazonasgebiet und im Grenzstreifen erfasst.",
    closing: "Hochachtungsvoll,",
    signedBy: "Beschäftigte der Bundeseinrichtungen der Hochschulbildung, ihre Interessenvertretungen und organisierte Zivilgesellschaft.",
    consentBr: "Ich habe den Petitionstext gelesen und stimme zu. Ich ermächtige ADUNIR, meinen Namen, meine Kategorie und Einrichtung oder Stadt in die an die Behörden gesendete Liste aufzunehmen und meinen Vornamen in der öffentlichen Liste der neuesten Unterschriften der Seite anzuzeigen.",
    consentForeign: "Ich habe den Petitionstext gelesen und stimme zu. Ich ermächtige ADUNIR, meinen Namen, mein Land und meine Universität in die an die Behörden gesendete Liste aufzunehmen und meinen Vornamen (mit der Flagge meines Landes) in der öffentlichen Liste der neuesten Unterschriften der Seite anzuzeigen.",
  },
};

/* ===================== Texto para estrangeiros (parte 1 adaptada; razões reaproveitadas) ===================== */
function foreignIntro(l: Locale): string[] {
  const b = BR[l].intro;
  const own: Record<Locale, string[]> = {
    pt: [
      "Nós, professores, técnicos e acadêmicos de instituições de ensino e pesquisa ({where}), conhecemos a realidade dos nossos colegas que trabalham em regiões afastadas dos grandes centros e, por isso, nos solidarizamos com eles e apoiamos esta causa. Dirigimo-nos ao Presidente da República Federativa do Brasil para solicitar a SANÇÃO INTEGRAL do Projeto de Lei de Conversão (PLV) nº 12/2026, aprovado pelo Congresso Nacional, com especial atenção à inclusão dos servidores da educação federal na Indenização de Localidades Estratégicas (ILE), em todos os Campi situados na Amazônia Legal e na Faixa de Fronteira.",
      "Esta manifestação é feita por pessoas de fora do Brasil que reconhecem o papel das universidades e institutos federais brasileiros na produção de conhecimento, na cooperação científica internacional e no desenvolvimento regional. O projeto foi aprovado pela Câmara dos Deputados em 27 de outubro de 2026 e pelo Senado Federal em 28 de outubro de 2026, e aguarda sanção.",
    ],
    en: [
      "We, professors, technical staff and scholars of teaching and research institutions ({where}), know the reality of our colleagues who work in regions far from the major centers and, for that reason, we stand in solidarity with them and support this cause. We address the President of the Federative Republic of Brazil to request the FULL SANCTION of Conversion Bill (PLV) No. 12/2026, approved by the National Congress, with special attention to the inclusion of federal education staff in the Strategic Locations Allowance (ILE), at all campuses located in the Legal Amazon and the Border Strip.",
      "This statement is made by people outside Brazil who recognize the role of Brazilian federal universities and institutes in producing knowledge, in international scientific cooperation and in regional development. The bill was approved by the Chamber of Deputies on 27 October 2026 and by the Federal Senate on 28 October 2026, and awaits sanction.",
    ],
    es: [
      "Nosotros, profesores, técnicos y académicos de instituciones de enseñanza e investigación ({where}), conocemos la realidad de nuestros colegas que trabajan en regiones alejadas de los grandes centros y, por eso, nos solidarizamos con ellos y apoyamos esta causa. Nos dirigimos al Presidente de la República Federativa de Brasil para solicitar la SANCIÓN ÍNTEGRA del Proyecto de Ley de Conversión (PLV) n.º 12/2026, aprobado por el Congreso Nacional, con especial atención a la inclusión del personal de la educación federal en la Indemnización de Localidades Estratégicas (ILE), en todos los Campus situados en la Amazonía Legal y en la Franja de Frontera.",
      "Esta manifestación la hacen personas de fuera de Brasil que reconocen el papel de las universidades e institutos federales brasileños en la producción de conocimiento, en la cooperación científica internacional y en el desarrollo regional. El proyecto fue aprobado por la Cámara de Diputados el 27 de octubre de 2026 y por el Senado Federal el 28 de octubre de 2026, y aguarda sanción.",
    ],
    fr: [
      "Nous, enseignants, personnels techniques et universitaires d'établissements d'enseignement et de recherche ({where}), connaissons la réalité de nos collègues qui travaillent dans des régions éloignées des grands centres et, pour cette raison, nous sommes solidaires d'eux et soutenons cette cause. Nous nous adressons au Président de la République fédérative du Brésil pour demander la SANCTION INTÉGRALE du Projet de loi de conversion (PLV) n° 12/2026, approuvé par le Congrès national, avec une attention particulière à l'inclusion des personnels de l'éducation fédérale dans l'Indemnité de Localités Stratégiques (ILE), dans tous les Campus situés en Amazonie légale et dans la Zone frontalière.",
      "Cette démarche est faite par des personnes hors du Brésil qui reconnaissent le rôle des universités et instituts fédéraux brésiliens dans la production de connaissances, la coopération scientifique internationale et le développement régional. Le projet a été approuvé par la Chambre des députés le 27 octobre 2026 et par le Sénat fédéral le 28 octobre 2026, et attend la sanction.",
    ],
    de: [
      "Wir, Professorinnen, Professoren, technisches Personal und Wissenschaftler von Lehr- und Forschungseinrichtungen ({where}), kennen die Lage unserer Kolleginnen und Kollegen, die in Regionen fern der großen Zentren arbeiten, und solidarisieren uns daher mit ihnen und unterstützen dieses Anliegen. Wir wenden uns an den Präsidenten der Föderativen Republik Brasilien mit der Bitte um die VOLLSTÄNDIGE SANKTIONIERUNG des Umwandlungsgesetzentwurfs (PLV) Nr. 12/2026, vom Nationalkongress verabschiedet, mit besonderem Augenmerk auf die Einbeziehung der Beschäftigten der Bundesbildung in die Zulage für strategische Standorte (ILE), an allen Campus im Legalen Amazonasgebiet und im Grenzstreifen.",
      "Diese Erklärung wird von Menschen außerhalb Brasiliens abgegeben, die die Rolle der brasilianischen Bundesuniversitäten und -institute bei der Wissensproduktion, der internationalen wissenschaftlichen Zusammenarbeit und der regionalen Entwicklung anerkennen. Der Entwurf wurde am 27. Oktober 2026 vom Abgeordnetenhaus und am 28. Oktober 2026 vom Bundessenat verabschiedet und wartet auf die Sanktionierung.",
    ],
  };
  // Parágrafos 3 em diante do texto brasileiro (valor da indenização, desafios, apelo ao MGI, valorização, fecho) são reaproveitados.
  return [...own[l], ...b.slice(2)];
}
const EST_SIGNED: Record<Locale, string> = {
  pt: "Professores, técnicos e acadêmicos de instituições de ensino e pesquisa do exterior, em apoio aos servidores das Instituições Federais de Ensino do Brasil.",
  en: "Professors, technical staff and scholars of teaching and research institutions abroad, in support of the staff of Brazil's Federal Educational Institutions.",
  es: "Profesores, técnicos y académicos de instituciones de enseñanza e investigación del exterior, en apoyo al personal de las Instituciones Federales de Enseñanza de Brasil.",
  fr: "Enseignants, personnels techniques et universitaires d'établissements d'enseignement et de recherche à l'étranger, en soutien aux personnels des Établissements fédéraux d'enseignement du Brésil.",
  de: "Professorinnen, Professoren, technisches Personal und Wissenschaftler von Lehr- und Forschungseinrichtungen im Ausland, zur Unterstützung der Beschäftigten der brasilianischen Bundesbildungseinrichtungen.",
};
const EST = Object.fromEntries((Object.keys(BR) as Locale[]).map((l) => [l, { ...BR[l], intro: foreignIntro(l), signedBy: EST_SIGNED[l] }])) as Record<Locale, Doc>;

export const PETICAO_BR = BR;
export const PETICAO_EST = EST;

/** Texto de referência (português do Brasil) usado no PDF e nos testes. */
export const PETICAO = { ...BR.pt, organizer: ORGANIZER, consentLabel: BR.pt.consentBr };
export const PETICAO_EST_PT = EST.pt;

/** Versão em português para o PDF dos estrangeiros: "{where}" vira a lista dos países presentes no lote. */
export function estrangeiroPdfPt(countriesPt: string[]): Doc {
  const list = countriesPt.length > 1 ? `${countriesPt.slice(0, -1).join(", ")} e ${countriesPt[countriesPt.length - 1]}` : countriesPt[0] ?? "—";
  const where = countriesPt.length > 1 ? `países: ${list}` : `país: ${list}`;
  return { ...EST.pt, intro: EST.pt.intro.map((p) => p.replace("{where}", where)) };
}

/** Hash dos textos de referência (BR e estrangeiro, em português), gravado junto de cada assinatura. */
export const TEXT_VERSION = createHash("sha256").update(JSON.stringify([BR.pt, EST.pt])).digest("hex");
