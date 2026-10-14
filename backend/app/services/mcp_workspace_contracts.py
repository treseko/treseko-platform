"""MCP schemas derived from existing workspace authoring contracts."""
from copy import deepcopy
from .. import schemas

UUID_SCHEMA = {"type": "string", "format": "uuid"}
PAGE = {"limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}
SPECS = {}


def add(key, capability, scope, properties=None, required=(), *, model=None, omit=(), mutation=False, target=None):
    props = {"project_id": UUID_SCHEMA, **(properties or {})}
    needed = ["project_id", *required]
    definitions = {}
    if model:
        generated = deepcopy(model.model_json_schema())
        fields = {k: v for k, v in generated.get("properties", {}).items() if k not in omit}
        props["data"] = {"type": "object", "properties": fields, "additionalProperties": False, "required": [k for k in generated.get("required", []) if k not in omit], "minProperties": 1}
        definitions = generated.get("$defs", {})
        needed.append("data")
    if target:
        props[target] = UUID_SCHEMA
        needed.append(target)
    if mutation:
        props.update(confirmation={"type": "string", "const": key.upper().replace(".", "_").replace("-", "_")}, idempotency_key={"type": "string", "minLength": 1, "maxLength": 128})
        needed += ["confirmation", "idempotency_key"]
        if key.endswith(".update"):
            props["expected_revision"] = {"type": "string", "pattern": "^[0-9a-f]{64}$", "description": "revision returned by get; refresh and reconcile on conflict"}
            needed.append("expected_revision")
    schema = {"type": "object", "additionalProperties": False, "properties": props, "required": needed}
    if definitions:
        schema["$defs"] = definitions
    SPECS[key] = {"schema": schema, "capability": capability, "scope": scope, "mutation": mutation}


add("organizations.list", "proyectos.portfolio", "mcp.workspace.projects.read", PAGE)
add("projects.list", "proyectos.portfolio", "mcp.workspace.projects.read", {**PAGE, "organization_id": UUID_SCHEMA}, ["organization_id"])
add("projects.create", "proyectos.portfolio", "mcp.workspace.projects.write", {"organization_id": UUID_SCHEMA}, ["organization_id"], model=schemas.ProyectoCreate, omit=("organizacion_id",), mutation=True)
add("projects.get", "proyectos.portfolio", "mcp.workspace.projects.read")
add("projects.update", "proyectos.portfolio", "mcp.workspace.projects.write", model=schemas.ProyectoUpdate, omit=("organizacion_id",), mutation=True)
add("components.list", "proyectos.portfolio", "mcp.workspace.projects.read", PAGE)
for family, capability, create, update, target in (
    ("requirements", "proyectos.requisitos", schemas.RequisitoCreate, schemas.RequisitoUpdate, "requirement_id"),
    ("stories", "proyectos.historias", schemas.HistoriaCreate, schemas.HistoriaUpdate, "story_id"),
    ("wiki", "proyectos.wiki", schemas.WikiPageCreate, schemas.WikiPageUpdate, "page_id"),
):
    read, write = f"mcp.workspace.{family}.read", f"mcp.workspace.{family}.write"
    add(f"{family}.list", capability, read, PAGE)
    get_properties = {"content_offset": {"type": "integer", "minimum": 0}, "content_limit": {"type": "integer", "minimum": 1, "maximum": 16000}} if family == "wiki" else {}
    add(f"{family}.get", capability, read, get_properties, target=target)
    add(f"{family}.create", capability, write, model=create, omit=("proyecto_id", "creado_por"), mutation=True)
    add(f"{family}.update", capability, write, model=update, omit=("expected_revision",), target=target, mutation=True)
    add(f"{family}.history", capability, read, {**PAGE, **get_properties}, target=target)
# These two organization-scoped operations bootstrap a client without an
# existing project. Their idempotency namespace is the explicitly selected org.
for key in ("organizations.list", "projects.list", "projects.create"):
    SPECS[key]["schema"]["properties"].pop("project_id")
    SPECS[key]["schema"]["required"].remove("project_id")
