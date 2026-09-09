# Notificaciones y correo

Las notificaciones pueden aparecer en la bandeja interna y, si la instalación
lo permite, enviarse por email. Incluyen eventos de bugs, estados, ejecuciones,
evidencia, revisiones IA y calidad.

## Configurar correo como administrador

1. Abrí **Configuración → Correo**.
2. Completá SMTP, puerto, remitente y credenciales.
3. Guardá.
4. Enviá un correo de prueba.
5. Activá reglas después de comprobar la entrega.

La contraseña SMTP no vuelve a mostrarse. Si cambia, actualizala y repetí la
prueba. No pongas credenciales en plantillas ni capturas.

## Reglas, plantillas y preferencias

Según tus permisos podés activar reglas, administrar y previsualizar plantillas,
controlar preferencias, consultar inbox y marcar mensajes como leídos. También
pueden existir digests diarios, semanales o mensuales. Las plantillas deben
usar enlaces y nombres legibles, sin secretos ni payloads innecesarios.

## Entrega y auditoría

Los eventos y entregas permiten revisar si un aviso fue creado, procesado,
enviado o falló. Si no llega:

1. enviá una prueba SMTP;
2. revisá destinatario, regla y preferencia;
3. consultá el estado de entrega;
4. corregí y reintentá solo después de resolver la causa.

Inbox y email son canales distintos: un correo fallido no elimina el evento
interno. Los destinatarios externos deben respetar el alcance permitido.
