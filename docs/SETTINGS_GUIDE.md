# Guía de Configuración

**Configuración** reúne opciones administrativas y personales. Las pestañas y
acciones dependen del rol, capacidades, instancia y edición disponible.

## Preferencias y cuenta

En **Mi Perfil** mantené tus datos y preferencias. Si la instancia ofrece
idioma, se guarda para tu cuenta; algunos mensajes generados por backend o
exportaciones pueden depender de la configuración del formato.

En **Preferencias** revisá opciones generales y, cuando estén habilitadas,
claves de automatización externa. Guardá cada clave en un gestor de secretos y
revocala cuando deje de usarse.

## Usuarios, roles y auditoría

**Gestión Usuarios** administra cuentas; **Roles** asigna capacidades y
**Auditoría** consulta acciones administrativas. La expiración disponible se
configura en **Preferencias → Sesión y seguridad**; la edición base no incluye
una bandeja general para revisar o revocar sesiones activas. El acceso efectivo
combina rol, permiso de módulo y capacidad específica. Si necesitás ampliarlo,
pedí a un administrador que confirme tu rol y capacidades.

## Correo, IA, monitor e integraciones

- **Correo:** SMTP, reglas, plantillas, inbox y entregas.
- **Pruebas con IA:** proveedores, modelos y workflows.
- **Monitor:** componentes, workers y ejecuciones técnicas.
- **Integraciones:** catálogo, estado, prueba de conexión y configuración.
- **Complementos:** conexiones y vínculos disponibles.
- **Adjuntos y evidencias:** límites y política de carga.

Consultá [Notificaciones](NOTIFICATIONS_EMAIL.md), [Motor IA](AI_ENGINE_CONFIG.md)
y [Adjuntos](ATTACHMENTS_EVIDENCE.md). Las integraciones visibles dependen de
la instalación y sus permisos.

## Licencia y actualizaciones

En **Licencia** revisá la edición y capacidades que la instancia reconoce. El
nombre comercial no reemplaza la comprobación de una capacidad. En
**Actualizaciones**, revisá versión, backup y entorno controlado antes de
actualizar producción. No se prometen aquí capacidades comerciales no
verificables en la instalación.
