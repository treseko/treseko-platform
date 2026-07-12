Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   EJECUTANDO SUITE DE PRUEBAS - TRACKME" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# Prueba 1: Interacción Básica y Verificación
Write-Host "`n[1/4] Ejecutando TL-01: Verificar aparición de nuevo campo..." -ForegroundColor Yellow
npx tsx src/index.ts --url "https://practicetestautomation.com/practice-test-exceptions/" --task "Hacer clic en el botón 'Add' y verificar visualmente que aparezca un segundo campo de texto (Row 2) en la pantalla." --test-id "TL-01" --suite "Trackme" --max-steps 10

# Prueba 2: Interacción Secuencial y Llenado de Datos
Write-Host "`n[2/4] Ejecutando TL-02: Agregar, escribir y guardar..." -ForegroundColor Yellow
npx tsx src/index.ts --url "https://practicetestautomation.com/practice-test-exceptions/" --task "Hacer clic en 'Add'. Una vez que aparezca la segunda fila, escribir 'Manzana' en ese nuevo campo de texto y hacer clic en su botón 'Save' correspondiente. Verificar que aparezca un mensaje de confirmación." --test-id "TL-02" --suite "Trackme" --max-steps 15

# Prueba 3: Edición de Estado Existente
Write-Host "`n[3/4] Ejecutando TL-03: Editar campo existente..." -ForegroundColor Yellow
npx tsx src/index.ts --url "https://practicetestautomation.com/practice-test-exceptions/" --task "Hacer clic en el botón 'Edit' de la primera fila. Reemplazar el texto existente por 'Sushi' en el campo de texto y hacer clic en 'Save'. Verificar que el campo ahora contenga la palabra Sushi." --test-id "TL-03" --suite "Trackme" --max-steps 15

# Prueba 4: Flujo Complejo de Creación y Destrucción (Full Lifecycle)
Write-Host "`n[4/4] Ejecutando TL-04: Borrar un elemento dinámico..." -ForegroundColor Yellow
npx tsx src/index.ts --url "https://practicetestautomation.com/practice-test-exceptions/" --task "Hacer clic en 'Add'. Una vez que aparezca la segunda fila (Row 2), hacer clic en el botón 'Remove' específicamente de esa nueva fila. Verificar visualmente que el segundo cuadro haya desaparecido." --test-id "TL-04" --suite "Trackme" --max-steps 20

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host "   PRUEBAS FINALIZADAS" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green