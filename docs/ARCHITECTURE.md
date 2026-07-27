# Arquitectura de Treseko

Esta guía ofrece una vista técnica de la instalación self-hosted. Sirve para
administradores que necesitan identificar qué componente revisar ante un
problema, hacer una copia de seguridad o integrar un servicio externo.

## Componentes principales

```text
Navegador → Frontend → Backend → Base de datos
                         ├→ Motor IA
                         └→ Worker de automatización
```

| Componente | Función | Cuándo revisarlo |
|---|---|---|
| Frontend | Muestra la plataforma en el navegador. | La página no carga o una pantalla no responde. |
| Backend | Aplica permisos, reglas de negocio y expone la API. | Una acción devuelve un error o no guarda datos. |
| Base de datos | Conserva proyectos, casos, ejecuciones, usuarios y configuración. | Antes de restaurar o migrar información. |
| Motor IA | Ejecuta los flujos asistidos por IA. | Una generación o ejecución IA no inicia. |
| Worker | Ejecuta scripts automatizados en una máquina compatible. | Un job no se toma o falla en el entorno de prueba. |

## Cómo se relacionan

- El navegador se comunica con el backend mediante la aplicación web.
- El backend persiste la información y valida permisos antes de cada acción.
- El Motor IA y los workers reportan resultados al backend; no escriben
  directamente en la base de datos.
- Los adjuntos se almacenan como archivos y quedan vinculados a casos,
  ejecuciones o bugs mediante sus metadatos.

## Datos y trazabilidad

La información operativa sigue esta relación principal:

```text
Solución → Proyecto → Componente → Build → Caso → Ejecución → Evidencia
```

Los requisitos e historias se vinculan con los casos para medir cobertura. Las
ejecuciones conservan una instantánea de los pasos y datos usados, de modo que
un cambio posterior al caso no altera el resultado histórico.

## Seguridad y operación

- Los permisos se validan en el backend, no solo en la interfaz.
- Las API keys, credenciales de IA e integraciones deben guardarse como
  secretos de despliegue o desde la configuración protegida de Treseko.
- Realizá copias de seguridad de la base de datos y del almacenamiento de
  adjuntos antes de actualizar o cambiar infraestructura.
- No expongas el backend, la base de datos ni el Motor IA directamente a
  Internet sin un proxy y controles de acceso apropiados.

## Dónde continuar

- [Instalación rápida](INSTALLATION.md)
- [Guía Docker](DOCKER_GUIDE.md)
- [Base de datos y respaldos](DATABASE.md)
- [Worker de automatización](AUTOMATION_WORKER_V1.md)
- [Configuración del Motor IA](AI_ENGINE_CONFIG.md)
