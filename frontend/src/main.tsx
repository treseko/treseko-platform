import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import 'bootstrap/dist/css/bootstrap.min.css'
import './styles.css'
import { installTestTraceFetch } from './shared/utils/testTrace.ts'

installTestTraceFetch()

class GlobalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  retry = () => {
    this.setState({ hasError: false })
  }

  goToDashboard = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'dashboard')
    window.location.assign(url.toString())
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-vh-100 d-flex align-items-center justify-content-center bg-light text-dark p-4">
          <section className="bg-white border rounded-3 shadow-sm p-4" style={{ maxWidth: 520 }}>
            <h1 className="h5 fw-bold mb-2">No se pudo cargar Treseko</h1>
            <p className="text-muted mb-3">Ocurrio un error inesperado en la interfaz. Puedes reintentar o salir de esta pantalla sin cerrar el navegador.</p>
            <div className="d-flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={this.retry}>Reintentar</button>
              <button type="button" className="btn btn-outline-secondary" onClick={this.goToDashboard}>Ir al inicio</button>
              <button type="button" className="btn btn-link text-secondary" onClick={() => window.location.reload()}>Recargar página</button>
            </div>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection', event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
)
