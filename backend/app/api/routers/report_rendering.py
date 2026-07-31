import os
import re
import csv
import io
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

from ...evidence_url_security import sanitize_evidence_url
from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error


__all__ = [
    "_report_public_url",
    "_flatten_report_cases",
    "_report_badge_class",
    "_render_report_evidence",
    "_render_report_distribution",
    "_render_report_trend",
    "_render_report_cases",
    "_render_report_failed_steps",
    "_render_report_bugs",
    "_report_type_from_payload",
    "_report_common_css",
    "_report_context_html",
    "_render_executive_issues",
    "_render_bug_severity_summary",
    "_render_development_failures",
    "_render_bug_tracking",
    "_render_development_actions",
    "_shared_report_html",
    "_shared_report_csv",
    "_md",
    "_markdown_evidence",
    "_shared_report_markdown",
    "_report_link_url",
]


from .report_rendering_base import *
from .report_rendering_sections import *
from .report_rendering_metrics import *
from .report_rendering_html import *
from .report_rendering_markdown import *

__all__ = [
    "_report_public_url",
    "_flatten_report_cases",
    "_report_badge_class",
    "_render_report_evidence",
    "_render_report_distribution",
    "_render_report_trend",
    "_render_report_cases",
    "_render_report_failed_steps",
    "_render_report_bugs",
    "_report_type_from_payload",
    "_report_common_css",
    "_report_context_html",
    "_render_executive_issues",
    "_render_bug_severity_summary",
    "_render_development_failures",
    "_render_bug_tracking",
    "_render_development_actions",
    "_shared_report_html",
    "_shared_report_csv",
    "_md",
    "_markdown_evidence",
    "_shared_report_markdown",
    "_report_link_url",
]
