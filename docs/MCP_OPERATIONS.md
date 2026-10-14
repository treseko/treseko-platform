# Operación MCP

MCP se activa mediante Configuración → MCP y el estado persistido `mcp.enabled`. Cada petición vuelve a comprobarlo; una falla de base de datos deshabilita el acceso hasta recuperarse. `TRESEKO_MCP_ENABLED` no sustituye la activación persistida. Declarar `TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process` para un proceso; con réplicas/workers declarar `shared_redis` y un Redis común saludable. Las configuraciones ambiguas fallan cerradas.

Aplicar migraciones Alembic hasta `20261010_0075` antes de arrancar la versión nueva. Agrega cola durable y recibos de workspace sin borrar datos. El dispatcher arranca con backend, conserva pendientes y marca ejecuciones interrumpidas sin repetir HTTP. Respaldar la base antes de migrar una instalación real.

En Docker el resolver interno usa `http://backend:8000/mcp/internal/runtime-credential`. Engine admite esta red privada solamente si el administrador declara exactamente `MCP_RUNTIME_RESOLVER_TRUSTED_PRIVATE_ORIGINS=http://backend:8000`; endpoints MCP externos siguen bloqueando redes privadas. Mantener el secreto del resolver fuera de código/documentos. La fijación DNS preserva Host y SNI TLS y limita el tamaño de respuesta.

Consultar el endpoint efectivo, catálogo y scopes en Configuración. Se pueden pausar, reactivar y revocar credenciales incluso con MCP deshabilitado. Una credencial pausada no equivale a revocada. Cambiar sesión/permisos borra la clave de un solo uso de la interfaz. No copiar claves de navegador a prompts.

Si una llamada falla, distinguir autenticación/permisos, esquema inválido, conflicto de revisión, límite de respuesta, interrupción y error interno. Revisar auditoría y estado de la ejecución. Para reintentos de mutación mantener argumentos y clave; nunca asumir que un timeout significa rollback. El detalle funcional está en [MCP_GUIDE.md](MCP_GUIDE.md).
