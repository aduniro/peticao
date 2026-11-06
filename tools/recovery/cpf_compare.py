"""Conservative name comparison; never claims to prove signer identity."""
from collections import Counter
import difflib
import re
import unicodedata

PARTICLES = {'da', 'de', 'do', 'das', 'dos', 'e'}
COMPARISON_COLUMNS = [
    'nome_classificacao', 'nome_confere', 'similaridade_nome_percentual',
    'diferencas_nome', 'palavras_ausentes_no_informado', 'palavras_extras_no_informado',
    'indicacao_titularidade', 'revisao_necessaria',
]


def normalized(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c))
    return ' '.join(''.join(c if c.isalpha() else ' ' for c in value).split())


def tokens(value):
    return [word for word in normalized(value).split() if word not in PARTICLES]


def compare(declared, returned):
    a, b = tokens(declared), tokens(returned)
    score = difflib.SequenceMatcher(None, normalized(declared), normalized(returned), autojunk=False).ratio()
    missing = list((Counter(b)-Counter(a)).elements())
    extra = list((Counter(a)-Counter(b)).elements())
    result = dict(zip(COMPARISON_COLUMNS, ['inconclusivo', 'inconclusivo', f'{score*100:.2f}', '',
                                         ', '.join(missing), ', '.join(extra), 'nao_determinado', 'sim']))
    if not a or not b:
        result['diferencas_nome'] = 'Nome ausente ou sem palavras suficientes para comparação.'
        return result
    # A single given name cannot identify a full name, even if both sources omit surnames.
    if len(a) < 2 or len(b) < 2:
        result.update(nome_classificacao='nome_insuficiente', diferencas_nome='Falta nome ou sobrenome para comparação confiável.')
        return result
    if declared == returned:
        result.update(nome_classificacao='coincidencia_exata', nome_confere='sim',
                      diferencas_nome='Textos idênticos.', indicacao_titularidade='nome_coincidente_identidade_nao_comprovada', revisao_necessaria='nao')
        return result
    if normalized(declared) == normalized(returned):
        result.update(nome_classificacao='coincidencia_normalizada', nome_confere='sim',
                      diferencas_nome='Diferenças apenas de acentuação, caixa, espaços ou pontuação.',
                      indicacao_titularidade='nome_coincidente_identidade_nao_comprovada', revisao_necessaria='nao')
        return result
    if a == b:
        result.update(nome_classificacao='variacao_de_particulas', nome_confere='sim',
                      diferencas_nome='Diferenças nas partículas da/de/do/das/dos/e ou na formatação.',
                      indicacao_titularidade='nome_compativel_identidade_nao_comprovada', revisao_necessaria='nao')
        return result
    if Counter(a) == Counter(b):
        result.update(nome_classificacao='ordem_diferente', nome_confere='parcial',
                      diferencas_nome='As mesmas palavras aparecem em ordem diferente.', indicacao_titularidade='inconclusivo_revisar')
        return result
    # A compatible subsequence with at least two full tokens is evidence of an
    # incomplete/abbreviated name, not proof that the signer owns the CPF.
    def compatible(x, y):
        return x == y or (len(x) == 1 and y.startswith(x))
    pos = 0
    full_matches = 0
    for word in a:
        found = next((i for i in range(pos, len(b)) if compatible(word, b[i])), None)
        if found is None:
            break
        full_matches += int(word == b[found] and len(word) > 1)
        pos = found + 1
    else:
        if full_matches >= 2 and compatible(a[0], b[0]) and compatible(a[-1], b[-1]):
            result.update(nome_classificacao='possivel_nome_incompleto_ou_abreviado', nome_confere='parcial',
                          diferencas_nome='Nome informado é uma sequência compatível do nome retornado; há omissões ou iniciais.',
                          indicacao_titularidade='nome_compativel_requer_revisao')
            return result
    ratios = [difflib.SequenceMatcher(None, x, y).ratio() for x, y in zip(a, b)]
    if len(a) == len(b) and score >= 0.88 and all(r >= 0.72 for r in ratios):
        result.update(nome_classificacao='possivel_erro_de_digitacao', nome_confere='parcial',
                      diferencas_nome='Grafias próximas, mas diferentes; possível digitação incorreta. Revisão necessária.',
                      indicacao_titularidade='inconclusivo_revisar')
        return result
    shared = set(a) & set(b)
    if not shared and difflib.SequenceMatcher(None, a[0], b[0]).ratio() < 0.65:
        result.update(nome_classificacao='divergencia_forte', nome_confere='nao',
                      diferencas_nome='Primeiro nome e demais palavras divergem; possível CPF de outra pessoa.',
                      indicacao_titularidade='possivel_cpf_de_outra_pessoa_nao_comprovado')
    else:
        result.update(nome_classificacao='divergencia_relevante', nome_confere='nao',
                      diferencas_nome='Há palavras incompatíveis; causa não determinada (pode incluir alteração de sobrenome ou nome social).',
                      indicacao_titularidade='inconclusivo_revisar')
    return result


def cpf_valid(cpf):
    if not isinstance(cpf, str) or not re.fullmatch(r'[0-9]{11}', cpf) or len(set(cpf)) == 1:
        return False
    for count in (9, 10):
        digit = (sum(int(cpf[i]) * (count+1-i) for i in range(count)) * 10) % 11
        if (0 if digit == 10 else digit) != int(cpf[count]):
            return False
    return True
