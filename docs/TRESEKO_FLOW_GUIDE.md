# Treseko Flow: grabar recorridos desde el navegador

Treseko Flow es una extensión opcional para Chrome y Edge. Se instala por
separado de la plataforma y registra acciones de una pestaña para crear un
recorrido editable o un script Playwright. No hace falta instalarla para usar
Treseko si no se necesita grabar recorridos.

## Elegir cómo usarla

| Lo que necesitás | Flujo |
| --- | --- |
| Grabar y repetir acciones en el navegador | Instalar Flow, abrir la página, grabar y usar **Reproducir** en la extensión. |
| Usar Treseko sin la extensión | Crear o importar un script de automatización y ejecutarlo con un Automation Worker compatible. |
| Pasar una grabación a Treseko | Grabar en Flow, elegir **Enviar a Treseko**, revisar el borrador en el editor de un caso automatizado y guardarlo desde Treseko. |

La extensión no incluye Treseko, Node.js ni `@playwright/test`. El botón
**Reproducir** de Flow repite acciones en Chrome o Edge; no ejecuta el archivo
Playwright. Para ejecutar el script guardado, usá el dry run o la ejecución
automatizada de Treseko con un Worker compatible.

## Grabar y guardar un recorrido

1. Instalá Treseko Flow desde el canal de distribución de la extensión. No está
   incluido en el paquete de Treseko Community.
2. Abrí en Chrome o Edge la página que quieras probar y pulsá el icono de Flow.
   La extensión captura la pestaña elegida; su ventana de trabajo puede abrirse
   como ventana independiente o como panel lateral, según Ajustes.
3. Iniciá la grabación, aceptá los permisos de acceso al sitio que solicite el
   navegador y realizá las acciones en la página.
4. Detené la grabación y revisá la lista: corregí valores o selectores, agregá
   comprobaciones, reordená pasos o eliminá los que no correspondan.
5. Reproducí el recorrido en el navegador si querés comprobar la captura local.
   Esta reproducción no valida que el runtime Node de Playwright pueda ejecutar
   el script en el Worker.
6. Para transferirlo, dejá abierta una pestaña de Treseko con sesión iniciada y
   el editor de un caso automatizado. Si hay varias instalaciones abiertas,
   elegí la pestaña destino. **Enviar a Treseko** carga el script en el editor
   como borrador; revisalo y guardá el caso en Treseko.
7. Ejecutá el caso desde Treseko con un Worker compatible. Para aplicaciones
   locales, el Worker debe poder alcanzar la URL de la aplicación; `localhost`
   desde el Worker es el equipo donde ese Worker está instalado.

También podés exportar el script desde Flow e importarlo en Treseko. La
transferencia desde el complemento no crea ni guarda casos automáticamente.

## Qué acciones captura

Flow genera pasos para interacciones comunes como clics, escritura, selección,
teclas, desplazamiento, hover, cambios de viewport, diálogos del navegador,
arrastres compatibles y navegación iniciada desde la página. Permite agregar
comprobaciones de visibilidad, texto, valor, URL y título. Los selectores y los
valores quedan editables antes de transferir o exportar el script.

La captura depende del navegador y de lo que la página exponga. Flow no controla
páginas internas de Chrome o Edge, diálogos nativos del sistema operativo ni
selectores de archivos. Los iframes y ventanas emergentes requieren permisos y
pueden presentar ambigüedad si hay más de un destino coincidente. Revisá el
recorrido y los datos sensibles antes de guardarlo.

## Cómo se conserva la privacidad

El recorrido se guarda localmente en el navegador. Solo se transfiere el script
cuando pulsás **Enviar a Treseko** y elegís una pestaña de destino; la extensión
usa la sesión existente de esa pestaña. Los campos reconocidos como sensibles
no se guardan como texto: el script utiliza variables que deben configurarse en
los datos del caso o el ambiente de Treseko.
