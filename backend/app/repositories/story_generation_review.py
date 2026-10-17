"""Helpers for aligning semantic story reviews with persisted criteria."""


def remap_semantic_criterion_ids(semantic_review, criterion_id_map):
    """Keep semantic-review references aligned with persisted criterion IDs."""
    if not isinstance(semantic_review, dict) or not isinstance(criterion_id_map, dict):
        return semantic_review
    for section in ("grounding", "coverage", "findings"):
        for item in semantic_review.get(section, []) or []:
            if isinstance(item, dict) and item.get("criterion_id") in criterion_id_map:
                item["criterion_id"] = criterion_id_map[item["criterion_id"]]
    for item in semantic_review.get("source_coverage", []) or []:
        if isinstance(item, dict) and isinstance(item.get("criterion_ids"), list):
            item["criterion_ids"] = [criterion_id_map.get(reference, reference) for reference in item["criterion_ids"]]
    return semantic_review
