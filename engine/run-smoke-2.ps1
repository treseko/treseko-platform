$tests = @(
    # --- CATEGORIA: ELEMENTOS BASICOS (DemoQA) ---
    @{id="TL-101"; task="Rellena Full Name con 'User Test' y pulsa Submit"; url="https://demoqa.com/text-box"},
    @{id="TL-102"; task="Marca los checkboxes 'Notes' y 'General'"; url="https://demoqa.com/checkbox"},
    @{id="TL-103"; task="Selecciona la opcion de radio 'Impressive'"; url="https://demoqa.com/radio-button"},
    @{id="TL-104"; task="Borra al usuario 'Cierra' de la tabla"; url="https://demoqa.com/webtables"},
    @{id="TL-105"; task="Haz doble click en el boton 'Double Click Me'"; url="https://demoqa.com/buttons"},
    @{id="TL-106"; task="Haz click derecho en el boton 'Right Click Me'"; url="https://demoqa.com/buttons"},
    @{id="TL-107"; task="Haz click en el link 'Created' y confirma que envia un status 201"; url="https://demoqa.com/links"},
    @{id="TL-108"; task="Sube un archivo de imagen en el campo de upload"; url="https://demoqa.com/upload-download"},
    @{id="TL-109"; task="Mueve el slider hasta el valor 85"; url="https://demoqa.com/slider"},
    @{id="TL-110"; task="Pasa el mouse sobre el boton 'Hover me to see' y verifica el tooltip"; url="https://demoqa.com/tool-tips"},

    # --- CATEGORIA: INTERACCIONES TECNICAS (Heroku) ---
    @{id="TL-111"; task="Login exitoso con 'tomsmith' y 'SuperSecretPassword!'"; url="http://the-internet.herokuapp.com/login"},
    @{id="TL-112"; task="Login fallido con 'admin' y 'admin' y verifica error"; url="http://the-internet.herokuapp.com/login"},
    @{id="TL-113"; task="Anade 3 elementos y luego borra el segundo"; url="http://the-internet.herokuapp.com/add_remove_elements/"},
    @{id="TL-114"; task="Selecciona 'Option 2' en el menu desplegable"; url="http://the-internet.herokuapp.com/dropdown"},
    @{id="TL-115"; task="Haz click en el checkbox 1 y verifica que este marcado"; url="http://the-internet.herokuapp.com/checkboxes"},
    @{id="TL-116"; task="Escribe el numero 42 en el campo de entrada numerico"; url="http://the-internet.herokuapp.com/inputs"},
    @{id="TL-117"; task="Haz click en 'Click for JS Alert' y aceptala"; url="http://the-internet.herokuapp.com/javascript_alerts"},
    @{id="TL-118"; task="Escribe 'Hola IA' en el JS Prompt y confirma"; url="http://the-internet.herokuapp.com/javascript_alerts"},
    @{id="TL-119"; task="Haz click en el boton 'Enable' y espera a que el input sea editable"; url="http://the-internet.herokuapp.com/dynamic_controls"},
    @{id="TL-120"; task="Arrastra el cuadro A sobre el cuadro B"; url="http://the-internet.herokuapp.com/drag_and_drop"},

    # --- CATEGORIA: FLUJOS DE E-COMMERCE (SauceDemo) ---
    @{id="TL-121"; task="Login inicial en la tienda con 'standard_user'"; url="https://www.saucedemo.com/"},
    @{id="TL-122"; task="Anade 'Sauce Labs Backpack' al carrito"; url="https://www.saucedemo.com/inventory.html"},
    @{id="TL-123"; task="Anade 3 productos cualquiera y ve al carrito"; url="https://www.saucedemo.com/inventory.html"},
    @{id="TL-124"; task="Ordena los productos de Z a A"; url="https://www.saucedemo.com/inventory.html"},
    @{id="TL-125"; task="Elimina un producto del carrito"; url="https://www.saucedemo.com/cart.html"},
    @{id="TL-126"; task="Completa Checkout paso 1 con datos ficticios"; url="https://www.saucedemo.com/checkout-step-one.html"},
    @{id="TL-127"; task="Verifica que el total sea correcto antes de finalizar"; url="https://www.saucedemo.com/checkout-step-two.html"},
    @{id="TL-128"; task="Finaliza compra y confirma mensaje 'Thank you'"; url="https://www.saucedemo.com/checkout-complete.html"},
    @{id="TL-129"; task="Haz Logout desde el menu hamburguesa"; url="https://www.saucedemo.com/inventory.html"},
    @{id="TL-130"; task="Intenta entrar al carrito sin loguearte y verifica error"; url="https://www.saucedemo.com/cart.html"},

    # --- CATEGORIA: ESCENARIOS DINAMICOS (UI Test Playground) ---
    @{id="TL-131"; task="Haz click en el boton azul y espera el mensaje AJAX"; url="http://uitestingplayground.com/ajax"},
    @{id="TL-132"; task="Haz click en el boton que tarda en aparecer (Client Side)"; url="http://uitestingplayground.com/clientdelay"},
    @{id="TL-133"; task="Haz click en el boton que cambia de ID dinamicamente"; url="http://uitestingplayground.com/dynamicid"},
    @{id="TL-134"; task="Haz click en el boton verde despues de esperar la barra"; url="http://uitestingplayground.com/progressbar"},
    @{id="TL-135"; task="Encuentra y haz click en el boton oculto en el scroll"; url="http://uitestingplayground.com/scroll"},
    @{id="TL-136"; task="Haz click en el boton que tiene un nombre de clase variable"; url="http://uitestingplayground.com/classattr"},
    @{id="TL-137"; task="Verifica que el boton azul no se puede clickear mientras carga"; url="http://uitestingplayground.com/click"},
    @{id="TL-138"; task="Escribe texto en un campo con delay de escritura"; url="http://uitestingplayground.com/textinput"},
    @{id="TL-139"; task="Interactua con la tabla y extrae el valor de la CPU de Chrome"; url="http://uitestingplayground.com/dynamictable"},
    @{id="TL-140"; task="Haz click en el boton que aparece tras un doble click"; url="http://uitestingplayground.com/verifytext"},

    # --- CATEGORIA: E2E Y NAVEGACION (Automation Exercise) ---
    @{id="TL-141"; task="Busca el producto 'Dress' en la barra de busqueda"; url="https://automationexercise.com/products"},
    @{id="TL-142"; task="Suscribete al newsletter con un email valido"; url="https://automationexercise.com/"},
    @{id="TL-143"; task="Ve a 'Contact Us' y rellena el formulario completo"; url="https://automationexercise.com/contact_us"},
    @{id="TL-144"; task="Verifica que hay productos en la categoria Women"; url="https://automationexercise.com/products"},
    @{id="TL-145"; task="Agrega el producto 'Blue Top' y verifica que esta en el carro"; url="https://automationexercise.com/product_details/1"},
    @{id="TL-146"; task="Aumenta la cantidad de un producto a 4 en el carrito"; url="https://automationexercise.com/view_cart"},
    @{id="TL-147"; task="Navega a Test Cases y confirma que existen casos de prueba"; url="https://automationexercise.com/test_cases"},
    @{id="TL-148"; task="Filtra por marca 'Polo' en la seccion de productos"; url="https://automationexercise.com/products"},
    @{id="TL-149"; task="Verifica que el boton 'Scroll Up' funciona correctamente"; url="https://automationexercise.com/"},
    @{id="TL-150"; task="Descarga la factura (Invoice) despues de una compra"; url="https://automationexercise.com/"}
)

# Ejecucion del bucle de pruebas
foreach ($test in $tests) {
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "`n[$timestamp] >>> RUNNING TEST $($test.id): $($test.task)" -ForegroundColor Cyan
    
    # Ejecucion del comando
    npx tsx src/index.ts --task $test.task --url $test.url --test-id $test.id --suite "smoke-tests"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[!] Test $($test.id) FAILED." -ForegroundColor Red
    } else {
        Write-Host "[OK] Test $($test.id) COMPLETED." -ForegroundColor Green
    }
}