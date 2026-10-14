import { lazy, Suspense } from 'react'

const AppRouteCoreContent = lazy(() => import('./AppRouteCoreContent').then(module => ({ default: module.AppRouteCoreContent })))
const AppRouteModuleContent = lazy(() => import('./AppRouteModuleContent').then(module => ({ default: module.AppRouteModuleContent })))

export function AppRouteContent({ options }: { options: any }) {
  return (
    <Suspense fallback={<div className="p-3 text-center text-muted" role="status">Cargando sección…</div>}>
      <AppRouteCoreContent options={options} />
      <AppRouteModuleContent options={options} />
    </Suspense>
  )
}
