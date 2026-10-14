from typing import Literal, Optional

from pydantic import BaseModel, Field


class BugOrderingOptions(BaseModel):
    sort: Literal["newest", "oldest", "priority"] = "newest"
    attention: Optional[Literal["open", "critical", "unassigned", "retest"]] = None


class ProjectBugListingOptions(BugOrderingOptions):
    attention: Optional[Literal["open", "critical", "unassigned", "retest", "no_evidence", "linked"]] = None
    include_summary: bool = False
    skip: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=500)


class IncidentCenterListingOptions(BugOrderingOptions):
    skip: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=200)
