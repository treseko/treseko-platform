from .schema_sections.auth import *
from .schema_sections.config import *
from .schema_sections.notifications import *
from .schema_sections.organizations import *
from .schema_sections.projects import *
from .schema_sections.inventory import *
from .schema_sections.wiki import *
from .schema_sections.scheduler import *
from .schema_sections.testing import *
from .schema_sections.execution import *
from .schema_sections.attachments import *
from .schema_sections.automation import *
from .schema_sections.ai import *
from .schema_sections.reports import *
from .schema_sections.bugs import *
from .schema_sections.external_api import *
from .schema_sections.extensions import *
from .schema_sections.system import *

from pydantic import BaseModel

for _schema in list(globals().values()):
    if isinstance(_schema, type) and issubclass(_schema, BaseModel) and _schema is not BaseModel:
        _schema.model_rebuild(_types_namespace=globals())

del BaseModel
del _schema
