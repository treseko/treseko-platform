# Integraciones y complementos

Una integración conecta Treseko con un sistema externo. Un complemento agrega
una capacidad dentro de Treseko. La sección **Complementos** muestra qué está
incluido, disponible o próximo para tu edición.

## Usar integraciones

Las integraciones permiten relacionar el trabajo de QA con herramientas como
Redmine, Jira, GitHub Issues, GitLab, Azure DevOps o un pipeline CI/CD cuando
la capacidad esté habilitada para tu instalación.

1. Abrí **Configuración → Complementos** o la sección de integración
   correspondiente.
2. Revisá si la integración figura como incluida, disponible o Premium.
3. Configurá solo las credenciales y datos autorizados por tu organización.
4. Probá la conexión antes de usarla en un proyecto.

Treseko no muestra secretos ya guardados. Si actualizás un token, guardalo en
la configuración de la integración y evitá copiarlo en casos, comentarios o
evidencias.

## Vincular bugs con herramientas externas

Desde el detalle de un bug podés preparar un resumen para copiar y pegar en una
herramienta externa y guardar el identificador o enlace del ticket creado. La
vinculación es explícita: Treseko no publica issues externos automáticamente.

Cada vínculo pertenece a un bug concreto. Si dos defectos necesitan tickets
distintos, registrá un vínculo para cada uno.

## Complementos

Los complementos incluidos amplían funciones como portabilidad de casos, Bug
Tracker interno, Motor IA y generación asistida. La tienda también puede mostrar
capacidades futuras o Premium; esas tarjetas informan su disponibilidad, no
instalan código de terceros en segundo plano.

## Permisos

La configuración de integraciones, secretos y complementos está restringida a
roles autorizados. Si podés ver una integración pero no configurarla, pedí al
administrador que revise tus permisos en Configuración.

## Ayuda rápida

- Verificá la conexión antes de usar una integración con datos reales.
- Usá una cuenta técnica con el menor alcance posible en la herramienta externa.
- Revocá y reemplazá un token si se expone.
- Consultá el estado de la licencia si una integración o complemento aparece
  como Premium.
