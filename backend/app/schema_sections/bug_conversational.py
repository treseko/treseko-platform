from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


CHATBOT_BUG_FINDING_TYPES = {
    "TURN_EXPECTATION_MISMATCH", "MEMORY_FAILURE", "TOOL_FAILURE", "SAFETY_VIOLATION",
    "HTTP_FAILURE", "INVALID_RESPONSE", "NO_RESPONSE", "EVALUATOR_DISAGREEMENT",
    "HUMAN_REVIEW_REQUIRED", "OTHER",
}


def validate_chatbot_finding_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip().upper()
    if normalized not in CHATBOT_BUG_FINDING_TYPES:
        raise ValueError("Categoría de hallazgo Chatbot inválida.")
    return normalized


class BugConversationalContextResponse(BaseModel):
    bug_id: UUID
    schema_version: int = 1
    case_snapshot: Dict[str, Any] = Field(default_factory=dict)
    execution_snapshot: Dict[str, Any] = Field(default_factory=dict)
    conversation_turns: List[Dict[str, Any]] = Field(default_factory=list)
    evaluation: Dict[str, Any] = Field(default_factory=dict)
    technical_evidence: Dict[str, Any] = Field(default_factory=dict)
    evidence_refs: List[Dict[str, Any]] = Field(default_factory=list)
    evidence_sha256: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
