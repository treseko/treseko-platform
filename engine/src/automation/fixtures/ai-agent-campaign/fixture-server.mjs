#!/usr/bin/env node
import http from 'node:http';

const host = process.env.AI_CAMPAIGN_FIXTURE_HOST || '127.0.0.1';
const port = Number(process.env.AI_CAMPAIGN_FIXTURE_PORT || 19220);

const layout = (title, body, script = '') => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title} | Treseko AI Lab</title>
<style>
body{font-family:Arial,sans-serif;margin:0;background:#f4f7fb;color:#172033}header{background:#172033;color:#fff;padding:18px 28px}main{max-width:900px;margin:28px auto;padding:24px;background:#fff;border:1px solid #dbe3ef}nav a{margin-right:14px}label{display:block;margin:12px 0 4px}input,select,button{font:inherit;padding:9px}button{cursor:pointer}.error{color:#b42318;background:#fee4e2;padding:10px}.success{color:#067647;background:#dcfae6;padding:10px}.hidden{display:none}.product,.row{padding:10px;border-bottom:1px solid #ddd}.modal{position:fixed;inset:20%;background:white;border:2px solid #172033;padding:24px}.badge{padding:3px 7px;background:#e8eef7}
</style></head><body><header><strong>Treseko AI Validation Lab</strong></header><main>
<nav><a href="/">Inicio</a><a href="/catalog">Catalogo</a><a href="/login">Login</a><a href="/form">Formulario</a></nav><hr>
${body}</main><script>${script}</script></body></html>`;

const pages = {
  '/': () => layout('Panel de validacion deterministica', `<h1>Panel de validacion deterministica</h1><p id="release">Release LAB-2026.07</p><button disabled>Operacion bloqueada</button>`),
  '/catalog': () => layout('Catalogo', `<h1>Catalogo de productos</h1><label for="search">Buscar producto</label><input id="search" placeholder="Buscar"><p id="count">3 productos visibles</p><div id="products"><div class="product">Aurora Keyboard - Disponible</div><div class="product">Boreal Mouse - Disponible</div><div class="product">Cirrus Monitor - Agotado</div></div>`, `
const search=document.querySelector('#search');const products=[...document.querySelectorAll('.product')];
search.addEventListener('input',()=>{let n=0;for(const item of products){const show=item.textContent.toLowerCase().includes(search.value.toLowerCase());item.hidden=!show;if(show)n++;}document.querySelector('#count').textContent=n+' productos visibles';});`),
  '/login': () => layout('Login', `<h1>Acceso al laboratorio</h1><form id="login"><label>Usuario</label><input name="username" autocomplete="username"><label>Contrasena</label><input name="password" type="password" autocomplete="current-password"><button>Ingresar</button></form><p id="message" aria-live="polite"></p>`, `
document.querySelector('#login').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('username')==='qa_user'&&f.get('password')==='correct-pass'){location.href='/secure';}else{const m=document.querySelector('#message');m.className='error';m.textContent='Credenciales invalidas. Intenta nuevamente.';}});`),
  '/secure': () => layout('Area segura', `<h1>Area segura</h1><p class="success">Sesion iniciada correctamente</p><a href="/login">Cerrar sesion</a>`),
  '/form': () => layout('Formulario', `<h1>Alta de incidencia</h1><form id="issue"><label>Titulo requerido</label><input name="title" required><label>Severidad</label><select name="severity"><option value="low">Baja</option><option value="high">Alta</option></select><label><input name="confirmed" type="checkbox"> Confirmar datos</label><button>Crear incidencia</button></form><p id="form-message" aria-live="polite"></p>`, `
document.querySelector('#issue').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),m=document.querySelector('#form-message');if(!f.get('title')){m.className='error';m.textContent='El titulo es obligatorio';return;}if(!f.get('confirmed')){m.className='error';m.textContent='Debes confirmar los datos';return;}m.className='success';m.textContent='Incidencia creada con severidad '+f.get('severity');});`),
  '/dynamic': () => layout('Contenido dinamico', `<h1>Contenido asincronico</h1><button id="load">Cargar resultado</button><p id="dynamic-result" class="hidden"></p>`, `document.querySelector('#load').onclick=()=>setTimeout(()=>{const r=document.querySelector('#dynamic-result');r.className='success';r.textContent='Resultado dinamico disponible';},700);`),
  '/modal': () => layout('Modal', `<h1>Gestion de dialogos</h1><button id="open">Abrir detalle</button><section id="modal" class="modal hidden" role="dialog" aria-modal="true"><h2>Detalle de auditoria</h2><p>Hallazgo confirmado</p><button id="close">Cerrar</button></section>`, `const m=document.querySelector('#modal');document.querySelector('#open').onclick=()=>m.classList.remove('hidden');document.querySelector('#close').onclick=()=>m.classList.add('hidden');`),
  '/table': () => layout('Tabla', `<h1>Usuarios de prueba</h1><label>Filtrar usuarios</label><input id="filter"><p id="row-count">3 filas visibles</p><div id="rows"><div class="row">Ana - Activo - QA Lead</div><div class="row">Bruno - Inactivo - Tester</div><div class="row">Carla - Activo - Auditor</div></div>`, `const f=document.querySelector('#filter'),rows=[...document.querySelectorAll('.row')];f.oninput=()=>{let n=0;for(const r of rows){const columns=r.textContent.split('-').map(value=>value.trim().toLowerCase());const query=f.value.trim().toLowerCase();const show=!query||columns.includes(query);r.hidden=!show;if(show)n++;}document.querySelector('#row-count').textContent=n+' filas visibles';};`),
  '/restricted': () => layout('Restringido', `<h1>Acceso denegado</h1><p class="error">No tienes permisos para ver este recurso</p>`),
  '/images': () => layout('Imagenes', `<h1>Galeria tecnica</h1><img alt="Logo valido" width="80" height="40" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='40'%3E%3Crect width='80' height='40' fill='%230b6'/%3E%3C/svg%3E"><img alt="Diagrama roto" src="/missing-diagram.png">`),
  '/json': () => layout('API JSON', `<h1>Respuesta de API</h1><pre id="json">{"status":"ok","items":3,"environment":"qa"}</pre>`),
};

const server = http.createServer((req, res) => {
  const path = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  if (path === '/health') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({status:'ok', service:'treseko-ai-campaign-fixture'}));
    return;
  }
  const render = pages[path];
  if (!render) {
    res.writeHead(404, {'content-type':'text/html; charset=utf-8'});
    res.end(layout('No encontrado', '<h1>404 - Recurso inexistente</h1><p class="error">La ruta solicitada no existe</p>'));
    return;
  }
  res.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-store'});
  res.end(render());
});

server.listen(port, host, () => console.log(`Treseko AI campaign fixture listening on http://${host}:${port}`));
