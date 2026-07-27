"""Deterministic safeguards around LLM story authoring output."""
from __future__ import annotations

import re
import unicodedata

TECHNICAL_ACTORS = {"sistema", "backend", "base de datos", "sistema de autenticación", "sistema de autenticacion"}
UNMEASURABLE = re.compile(r"\b(correctamente|rápidamente|rapidamente|seguro|segura)\b", re.I)
IMPLEMENTATION = re.compile(r"\b(hash|tabla(?:s)?|clase(?:s)?|selector(?:es)?\s+css|css|base de datos)\b", re.I)
LOGIN_TERMS = re.compile(r"\b(iniciar sesion|inicio de sesion|autenticaci[oó]n|login|credencial(?:es)?)\b", re.I)
INVALID_CREDENTIAL_TERMS = re.compile(r"\b(credencial(?:es)?\s+inv[aá]lid(?:a|as)|rechazo\s+de\s+(?:acceso|credenciales)|acceso\s+denegado)\b", re.I)
TITLE_STOP_WORDS = {
    "a", "al", "ante", "con", "de", "del", "el", "en", "la", "las", "los",
    "para", "por", "que", "un", "una", "y",
}


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\W+", " ", text).strip()


def _title_terms(value: str) -> set[str]:
    terms = set()
    for term in normalize(value).split():
        if len(term) <= 2 or term in TITLE_STOP_WORDS:
            continue
        # A deliberately small Spanish plural normalization keeps the check
        # explainable and avoids adding a language model to a fast path.
        if len(term) > 4 and term.endswith("es"):
            term = term[:-2]
        elif len(term) > 3 and term.endswith("s"):
            term = term[:-1]
        terms.add(term)
    return terms


def find_title_similarities(title: str, existing: list[dict]) -> list[dict]:
    """Fast, explainable title-only duplicate hinting for story proposals.

    This deliberately does not use the LLM or embeddings. It is advisory: the
    final QA user can still create a proposal that covers a distinct intent.
    """
    normalized_title = normalize(title)
    candidate_terms = _title_terms(title)
    if not normalized_title or not candidate_terms:
        return []

    matches = []
    for item in existing:
        existing_title = str(item.get("title") or item.get("titulo") or "").strip()
        normalized_existing = normalize(existing_title)
        existing_terms = _title_terms(existing_title)
        if not normalized_existing or not existing_terms:
            continue
        if normalized_title == normalized_existing:
            matches.append({
                "id": str(item.get("id") or ""),
                "codigo": str(item.get("codigo") or ""),
                "titulo": existing_title,
                "kind": "EXACT",
                "score": 1.0,
            })
            continue
        shared = candidate_terms & existing_terms
        score = len(shared) / len(candidate_terms | existing_terms)
        contained = min(len(candidate_terms), len(existing_terms)) >= 2 and (
            candidate_terms <= existing_terms or existing_terms <= candidate_terms
        )
        if contained or (len(shared) >= 2 and score >= 0.5):
            matches.append({
                "id": str(item.get("id") or ""),
                "codigo": str(item.get("codigo") or ""),
                "titulo": existing_title,
                "kind": "SIMILAR",
                "score": round(score, 2),
            })
    return sorted(matches, key=lambda item: (-item["score"], item["titulo"]))[:5]


def validate_proposal(proposal: dict, accepted_assumptions: set[str], existing: list[dict]) -> list[dict]:
    findings = []
    quality = proposal.setdefault("quality", {})
    actor, goal, benefit = (str(proposal.get(key) or "").strip() for key in ("actor", "goal", "benefit"))
    if proposal.get("story_type") == "USER_STORY":
        if normalize(actor) in TECHNICAL_ACTORS:
            findings.append({"code": "STORY_USER_ACTOR_TECHNICAL", "severity": "FAIL", "message": "Una USER_STORY no puede usar un actor técnico."})
        if not actor:
            findings.append({"code": "STORY_USER_ACTOR_REQUIRED", "severity": "FAIL", "message": "Una USER_STORY requiere un actor válido."})
    if not goal:
        findings.append({"code": "STORY_GOAL_REQUIRED", "severity": "FAIL", "message": "El objetivo es obligatorio."})
    if not benefit:
        findings.append({"code": "STORY_BENEFIT_REQUIRED", "severity": "FAIL", "message": "El beneficio es obligatorio."})
    fingerprint = normalize(" ".join([actor, goal, proposal.get("title", "")]))
    for other in existing:
        other_key = normalize(" ".join([other.get("actor", ""), other.get("goal", ""), other.get("title", "")]))
        if fingerprint and fingerprint == other_key:
            findings.append({"code": "STORY_DUPLICATE_NORMALIZED", "severity": "FAIL", "message": "La propuesta duplica una historia por actor, objetivo y título."})
            break
    # A rejected login is normally an acceptance criterion of authentication,
    # not an independent story. Keep both paths together unless the proposal
    # states a distinct user-facing capability.
    candidate_text = " ".join([str(proposal.get("title") or ""), goal, str(proposal.get("description") or "")])
    if INVALID_CREDENTIAL_TERMS.search(candidate_text):
        for other in existing:
            other_text = " ".join([
                str(other.get("title") or ""),
                str(other.get("goal") or ""),
                str(other.get("description") or ""),
                " ".join(
                    " ".join(str(value or "") for value in [criterion.get("title"), criterion.get("given"), criterion.get("when"), " ".join(criterion.get("then") or [])])
                    for criterion in (other.get("acceptance_criteria") or [])
                    if isinstance(criterion, dict)
                ),
            ])
            if LOGIN_TERMS.search(other_text) and INVALID_CREDENTIAL_TERMS.search(other_text):
                findings.append({"code": "STORY_NEGATIVE_FLOW_SPLIT", "severity": "FAIL", "message": "El rechazo de credenciales debe ser un criterio de aceptación de la historia de autenticación, no una historia separada."})
                break
    for criterion in proposal.get("acceptance_criteria") or []:
        refs = set(criterion.get("source_refs") or [])
        assumptions = set(criterion.get("assumption_ids") or [])
        if not criterion.get("given") or not criterion.get("when") or not criterion.get("then") or not criterion.get("observable_result"):
            findings.append({"code": "AC_GWT_OBSERVABLE_REQUIRED", "severity": "FAIL", "message": f"{criterion.get('local_id', 'criterio')} necesita condición, evento y resultado observable."})
        if not refs and not (assumptions & accepted_assumptions):
            findings.append({"code": "AC_TRACEABILITY_REQUIRED", "severity": "FAIL", "message": f"{criterion.get('local_id', 'criterio')} no está respaldado por fuente o supuesto aceptado."})
        content = " ".join([criterion.get("title", ""), criterion.get("given", ""), criterion.get("when", ""), " ".join(criterion.get("then") or [])])
        if criterion.get("type") == "FUNCTIONAL" and IMPLEMENTATION.search(content):
            findings.append({"code": "AC_IMPLEMENTATION_LEAKAGE", "severity": "FAIL", "message": f"{criterion.get('local_id', 'criterio')} expone implementación interna."})
        if UNMEASURABLE.search(" ".join([criterion.get("observable_result", ""), " ".join(criterion.get("then") or [])])):
            findings.append({"code": "AC_UNMEASURABLE_LANGUAGE", "severity": "WARN", "message": f"{criterion.get('local_id', 'criterio')} usa lenguaje no medible."})
    warnings = list(quality.get("warnings") or []) + [item["code"] for item in findings if item["severity"] == "WARN"]
    quality["warnings"] = sorted(set(warnings))
    quality["testability"] = "FAIL" if any(item["severity"] == "FAIL" for item in findings) else ("WARN" if warnings else "PASS")
    proposal["rule_findings"] = findings
    return findings
