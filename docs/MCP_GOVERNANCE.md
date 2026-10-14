# Gobierno MCP

Las herramientas se descubren por scopes y RBAC efectivos. Lecturas requieren `read`; mutaciones requieren `edit` en capacidad, organización y proyecto, confirmación y recibo idempotente. No se conceden permisos por instrucciones del modelo.

Las nuevas funciones workspace usan scopes separados de lectura/escritura. Las revisiones previenen sobrescrituras obsoletas y la transacción une cambios, recibos y auditoría. Los resultados conservan evidencia, redactan secretos y fallan explícitamente si exceden límites. Las anotaciones MCP describen cada operación; no sustituyen autorización.

Ver [Guía MCP](MCP_GUIDE.md) y [Operación MCP](MCP_OPERATIONS.md).
