# Notificaciones y correo

Las notificaciones por correo están disponibles con la capacidad Premium
correspondiente. Permiten avisar eventos importantes dentro de la plataforma y
por email: bugs asignados, cambios de estado, fallos o bloqueos de ejecución,
revisiones de IA y eventos de calidad.

## Configurar correo como administrador

1. Confirmá que la licencia incluya **Notificaciones y email**.
2. Abrí **Configuración → Correo**.
2. Completá el servidor SMTP, puerto, remitente y credenciales requeridas.
3. Guardá la configuración.
4. Enviá un correo de prueba antes de activar notificaciones para el equipo.

La contraseña SMTP queda protegida y no vuelve a mostrarse en la interfaz. Si
la cambiás en el proveedor de correo, actualizala también en Treseko y repetí la
prueba.

## Administrar reglas y plantillas

En la misma sección podés activar o desactivar reglas, elegir destinatarios y
ajustar las plantillas. Revisá cada regla antes de habilitarla para evitar
notificaciones innecesarias.

Las preferencias personales permiten que cada persona controle los avisos que
recibe dentro de la plataforma cuando esa opción está habilitada.

## Revisar entregas

Las entregas se registran para auditoría. Desde **Configuración → Auditoría**
podés revisar qué se intentó enviar, a quién y con qué resultado. Si una
entrega falla, corregí la configuración SMTP o el destinatario antes de
reintentarla.

## Ayuda rápida

- Si no llega un correo, enviá primero una prueba SMTP.
- Revisá las reglas activas y las preferencias del destinatario.
- Verificá que el servidor SMTP permita conexiones desde el host de Treseko.
- No pongas contraseñas SMTP en plantillas, notas o capturas de pantalla.
