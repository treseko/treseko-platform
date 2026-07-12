import { runTask } from './index';

const criticalSuite = [
  { id: 'TL-101-FIX', task: 'Rellena Full Name con "User Test", Email con "test@example.com" y pulsa Submit. Verifica que aparezca el cuadro de resultados abajo.', url: 'https://demoqa.com/text-box', guidance: '1. Type "User Test" in Full Name. 2. Type "test@example.com" in Email. 3. Click Submit.' },
  { id: 'TL-104-FIX', task: 'En la tabla, busca al usuario "Cierra" y haz clic en el icono del bote de basura para borrarlo. Verifica que el nombre "Cierra" ya no aparezca.', url: 'https://demoqa.com/webtables' },
  { id: 'TL-112-FIX', task: 'Intenta loguearte con usuario "invalid" y clave "invalid". Verifica que aparezca un mensaje de error en rojo.', url: 'https://demoqa.com/login' },
  { id: 'TL-115-FIX', task: 'Expande "Home", luego "Documents" y marca el checkbox "WorkSpace". Verifica que el texto de selección abajo mencione "workspace".', url: 'https://demoqa.com/checkbox' },
  { id: 'TL-117-FIX', task: 'Haz clic en el botón para ver la alerta (Click me) y acéptala.', url: 'https://demoqa.com/alerts' },
  { id: 'TL-120-FIX', task: 'Arrastra el elemento "Drag me" y suéltalo dentro del cuadro "Drop here". Verifica que el texto cambie a "Dropped!".', url: 'https://demoqa.com/droppable' },
  { id: 'TL-149-FIX', task: 'Haz scroll hasta el final de la página y verifica que el botón de "Scroll Up" sea visible o interactúa con él.', url: 'https://the-internet.herokuapp.com/infinite_scroll' }
];

async function runCriticalSuite() {
  console.log('🚀 Launching CRITICAL-SMOKE Suite...');
  const suiteName = 'critical-smoke-v4';
  
  for (const test of criticalSuite) {
    try {
      // @ts-ignore - test might have guidance
      await runTask(test.task, test.url, 15, test.id, suiteName, undefined, test.guidance);
    } catch (e) {
      console.error(`❌ Error in ${test.id}:`, e);
    }
  }
  console.log('\n✅ CRITICAL-SMOKE Suite finished.');
}

runCriticalSuite();
