"""Versioned, conservative spelling suggestions; never proves a person's legal name.

The corpus is public. Signer data stays in the local process. Originals and review
choices are not mutated by this module, and no external API is called at runtime.
"""
from collections import Counter
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata

CORPUS_PATH = Path(__file__).with_name("name-corpus.json")
PARTICLES = {"da", "de", "do", "das", "dos", "e", "di", "du", "del", "della", "van", "von", "der", "den", "la", "le"}
APOSTROPHES = str.maketrans({"’": "'", "ʼ": "'", "‘": "'"})
WORD = re.compile(r"[^\W\d_]+(?:['’ʼ‘-][^\W\d_]+)*", re.UNICODE)


def nfc(value):
    return unicodedata.normalize("NFC", str(value or ""))


def folded(value):
    # ø, ł, æ, ß etc. deliberately remain distinct: they are not combining accents.
    return "".join(c for c in unicodedata.normalize("NFD", nfc(value).translate(APOSTROPHES).lower()) if not unicodedata.combining(c))


def significant(value):
    return [folded(w) for w in WORD.findall(nfc(value)) if folded(w) not in PARTICLES]


def display_case(value):
    value = nfc(value)
    if not (value.isupper() or value.islower()):
        return value
    def word(match):
        text = match.group()
        if text.casefold() in PARTICLES:
            return text.lower()
        return "-".join("'".join(part[:1].upper() + part[1:].lower() for part in piece.split("'")) for piece in text.translate(APOSTROPHES).split("-"))
    return WORD.sub(word, value)


def corpus():
    observations = Path(os.environ.get("CPF_REVIEW_DATA_DIR", "/mnt/dev/cpfs/revisao")) / "name-observations.json"
    raw = _read_versioned(CORPUS_PATH)
    observed = _read_versioned(observations, optional=True)
    return _corpus(raw, observed)


def _read_versioned(path, optional=False):
    try:
        info = path.stat()
        return _read_bytes(str(path), info.st_mtime_ns, info.st_ctime_ns, info.st_size, info.st_ino)
    except FileNotFoundError:
        if optional:
            return b""
        raise


@lru_cache(maxsize=8)
def _read_bytes(path, mtime, ctime, size, inode):
    # File identity/version participates in the cache key; changed corpora reload.
    return Path(path).read_bytes()


@lru_cache(maxsize=2)
def _corpus(raw, observed):
    data = json.loads(raw)
    index = {}
    for entry in data["entries"]:
        index.setdefault(folded(entry["form"]), []).append(entry)
    if observed:
        observations = json.loads(observed)
        for entry in observations.get("entries", []):
            form = entry.get("form", "")
            # Observations are only individual tokens, never names/IDs/CPF joins.
            if not WORD.fullmatch(form) or len(form) > 80:
                continue
            item = {"form": nfc(form), "source": "local-observed", "count": max(0, int(entry.get("count", 0)))}
            index.setdefault(folded(form), []).append(item)
    digest = hashlib.sha256(raw + b"\0" + observed).hexdigest()[:12]
    return data, index, data["version"] + ":" + digest


def _has_accent(value):
    return nfc(value) != "".join(c for c in unicodedata.normalize("NFD", nfc(value)) if not unicodedata.combining(c))


def resolve(value, evidence=""):
    """Resolve a whole source independently, borrowing only aligned accent evidence."""
    data, index, version = corpus()
    value = nfc(value)
    evidence_words = {}
    for word in WORD.findall(nfc(evidence)):
        evidence_words.setdefault(folded(word), set()).add(display_case(word))
    details = []
    alternatives = []
    preferred = data.get("preferred", {})
    corrections = data.get("probable_accent_errors", {})

    def replace(match):
        original = match.group()
        key = folded(original)
        entries = index.get(key, [])
        variants = sorted(set(e["form"] for e in entries), key=lambda s: (s.casefold(), s))
        evidence_variants = sorted(v for v in evidence_words.get(key, set()) if _has_accent(v))
        correction = corrections.get(original.casefold())
        if correction:
            result = correction["suggestion"]
            status = "probable_accent_error"
        elif _has_accent(original):
            # Unknown accented forms remain intact, explicitly uncorroborated.
            result = display_case(original)
            matches = [e for e in entries if nfc(e["form"]).casefold() == original.casefold()]
            status = "supplied_in_editorial_corpus" if any(e["source"] != "local-observed" for e in matches) else "supplied_local_observation" if matches else "supplied_uncorroborated"
        elif len(evidence_variants) == 1:
            result = evidence_variants[0]
            status = "aligned_user_evidence"
        elif key in preferred:
            result = preferred[key]
            status = "curated_suggestion"
        elif len(variants) == 1 and any(e["source"] != "local-observed" for e in entries):
            result = variants[0]
            status = "editorial_variant"
        else:
            result = display_case(original)
            status = "local_observed_candidate" if entries and all(e["source"] == "local-observed" for e in entries) else "ambiguous" if len(variants) > 1 or len(evidence_variants) > 1 else "uncorroborated"
        candidates = list(dict.fromkeys([result] + evidence_variants + variants))
        details.append({"input": original, "suggestion": result, "status": status, "variants": candidates,
                        "sources": sorted({e["source"] for e in entries})})
        if len(candidates) > 1:
            alternatives.append({"input": original, "variants": candidates})
        return result

    result = WORD.sub(replace, value)
    # Collapse layout whitespace only, never add or remove letters or surnames.
    result = " ".join(result.split())
    return {"name": nfc(result), "details": details, "alternatives": alternatives, "dictionary_version": version}


def suggest(record):
    entered = nfc(record.get("name") or record.get("nome_informado") or "")
    api = nfc(record.get("nome_api") or "")
    a = resolve(entered)
    b = resolve(api, a["name"])
    at, bt = significant(entered), significant(api)
    substantive = bool(at and bt and at != bt)
    extra = list((Counter(at) - Counter(bt)).elements()) if bt else []
    missing = list((Counter(bt) - Counter(at)).elements()) if at else []
    reasons = []
    if entered and (not api or len(at) >= len(bt)):
        proposed, source = a["name"], "entered"
        reasons.append("Nome digitado mais completo em palavras relevantes; empate favorece o digitado." if api else "Sem nome da API; sugestão baseada somente no nome digitado.")
    else:
        proposed, source = b["name"], "api"
        reasons.append("Nome da API mais completo em palavras relevantes.")
    if substantive:
        reasons.append("Diferença substantiva de palavras ou ordem: decisão individual obrigatória; não mesclar sobrenomes.")
    if any(d["status"] in ("ambiguous", "uncorroborated", "supplied_uncorroborated", "local_observed_candidate", "supplied_local_observation") for d in a["details"] + b["details"]):
        reasons.append("Há grafias ambíguas ou sem corroboração no corpus; a sugestão não comprova a grafia civil.")
    if any(d["status"] == "probable_accent_error" for d in a["details"] + b["details"]):
        reasons.append("Possível erro de acento: foi sugerida uma grafia documentada, sujeita à aprovação.")
    choices = list(dict.fromkeys(v for v in (proposed, a["name"], b["name"], display_case(entered), display_case(api)) if v))
    return {"entered_resolved": a["name"], "api_resolved": b["name"], "proposed": proposed,
            "proposed_source": source, "special": substantive, "alternatives": choices,
            "reasons": reasons, "dictionary_version": a["dictionary_version"],
            "entered_analysis": a["details"], "api_analysis": b["details"],
            "variant_options": a["alternatives"] + b["alternatives"],
            "extra_entered": extra, "missing_entered": missing,
            "requires_approval": True}
