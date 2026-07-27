# Acceso, usuarios y permisos

Fecha de revisión: 2026-07-26.

Esta guía explica cómo ingresar a Treseko y cómo administrar quién puede ver o
modificar cada área de trabajo. La configuración de acceso se realiza desde la
plataforma; no hace falta usar la API.

## Qué podés administrar

Desde **Configuración** podés:

- crear, editar e inactivar usuarios;
- asignar un rol base o un rol personalizado;
- definir qué módulos puede consultar o editar cada rol;
- revisar los cambios relevantes en la auditoría;
- administrar las API keys de automatización externa desde **Preferencias**.

Para hacer estos cambios necesitás permisos de edición en Configuración. Si no
ves una sección, pedí a un administrador que revise tu rol.

## Ingresar a Treseko

Treseko admite el inicio de sesión local con email y contraseña. Cuando la
organización configuró Active Directory, LDAP u OIDC, también puede mostrar la
opción de acceso corporativo.

1. Abrí la pantalla de inicio de sesión.
2. Elegí el método disponible para tu organización.
3. Ingresá tus credenciales.
4. Al terminar, usá **Cerrar sesión** desde el menú de usuario.

La sesión vence según la política definida por el administrador. Si vence o si
tu contraseña cambia, iniciá sesión nuevamente.

### Si no podés ingresar

- Confirmá que el email y la contraseña sean correctos.
- Si usás acceso corporativo, verificá con tu equipo de identidad que tu cuenta
  siga activa.
- Pedí a un administrador que confirme que tu usuario no esté inactivo.
- Tras varios intentos fallidos, esperá unos minutos antes de volver a probar:
  Treseko limita los intentos para proteger las cuentas.

## Administrar usuarios

Abrí **Configuración → Gestión Usuarios** para consultar los usuarios activos y
crear o editar cuentas.

### Crear un usuario

1. Seleccioná **Nuevo usuario**.
2. Completá los datos solicitados y elegí el tipo de acceso disponible.
3. Asigná un rol base o un rol personalizado.
4. Guardá los cambios.

La persona podrá usar los permisos de su rol al iniciar sesión. Para limitar el
acceso de forma precisa, creá primero un rol personalizado y luego asignalo al
usuario.

### Editar o inactivar un usuario

Desde la fila del usuario podés actualizar sus datos, cambiar el rol o
inactivarlo. Inactivar conserva la trazabilidad: no elimina ejecuciones, casos,
auditoría ni otros registros históricos.

No podés inactivar tu propia cuenta. Pedí a otro administrador que lo haga si
es necesario.

## Trabajar con roles

Abrí **Configuración → Roles** para revisar y administrar los roles
personalizados.

### Roles base

Treseko incluye estos roles de referencia:

| Rol | Uso habitual |
|---|---|
| `ADMIN` | Administración global de la plataforma. |
| `QA_LEAD` | Gestión de proyectos, ejecuciones, reportes e integraciones. |
| `TESTER` | Creación y ejecución de pruebas. |
| `VIEWER` | Consulta sin modificación. |

Usalos como punto de partida. Cuando un equipo necesita un alcance distinto,
creá un rol personalizado.

### Crear un rol personalizado

1. Seleccioná **Nuevo rol**.
2. Indicá un nombre y una descripción que expliquen a quién está destinado.
3. Elegí el nivel de acceso para cada módulo.
4. Guardá el rol.
5. Asignalo desde **Gestión Usuarios** a las personas correspondientes.

Un rol personalizado permite mantener una misma regla de acceso para varias
personas. Si cambiás sus permisos, revisá qué usuarios lo tienen asignado antes
de guardar.

## Elegir permisos por módulo

Cada módulo puede tener uno de estos niveles:

| Nivel | Qué permite |
|---|---|
| Sin acceso | El usuario no puede acceder al módulo. |
| Lector | Puede consultar la información, sin modificarla. |
| Editor | Puede consultar y realizar las acciones de edición habilitadas. |

El nivel **Editor** incluye el acceso de lectura. Aplicá el menor privilegio
necesario: por ejemplo, un responsable que solo revisa métricas debería tener
**Lector** en Reportes y Métricas, no acceso de edición a Proyectos.

Los módulos que se pueden asignar incluyen Dashboard, Ejecutar Pruebas, Añadir
Pruebas, Proyectos, Inventario, Reportes y Métricas, Motor IA, integraciones,
Historial Runs y Configuración. La plataforma valida los permisos también al
realizar acciones sensibles, no solo al mostrar el menú.

## Auditoría y seguridad

Los cambios de usuarios, roles y permisos quedan registrados para que un
administrador pueda revisarlos. Usá la sección **Configuración → Auditoría**
cuando necesites saber qué cambió, quién lo hizo y cuándo.

Para mantener la cuenta segura:

- no compartas contraseñas ni API keys;
- usá una API key distinta por runner o pipeline de automatización;
- revocá una API key desde **Configuración → Preferencias → API keys de
  automatización externa** si deja de usarse o se expone;
- inactivá los usuarios que ya no deben acceder a la plataforma;
- revisá los roles luego de un cambio de responsabilidades.

## Acceso corporativo

Active Directory, LDAP y OIDC son opciones de autenticación corporativa que un
administrador habilita y configura para la organización. Estas opciones validan
la identidad de la persona; los permisos dentro de Treseko siguen definidos por
los roles y permisos configurados en Treseko.

Si tu organización usa estos métodos y no aparece la opción de ingreso, pedí al
administrador que revise su configuración y la licencia correspondiente.

## Ayuda rápida

| Situación | Qué hacer |
|---|---|
| No veo un módulo | Pedí la revisión de tu rol y sus permisos. |
| Puedo ver pero no editar | Solicitá nivel **Editor** para ese módulo, si tu función lo requiere. |
| Un usuario dejó el equipo | Inactivalo; no elimines la trazabilidad histórica. |
| Un runner no puede reportar ejecuciones | Revisá la API key, el permiso de ejecución del usuario y el acceso al proyecto y build. |
| Necesito permisos especiales | Creá un rol personalizado y describí claramente su propósito. |

Para la matriz detallada de capacidades por rol, consultá la
[matriz RBAC](RBAC_CAPABILITY_MATRIX.md).
