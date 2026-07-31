import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import 'bootstrap/dist/css/bootstrap.min.css'
import './styles.css'
import './app/themes/packages/graphite.css'
import { installTestTraceFetch } from './shared/utils/testTrace.ts'
import { I18nProvider, useI18n } from './i18n'

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
      return <ErrorFallbackView onRetry={this.retry} onGoHome={this.goToDashboard} />
    }
    return this.props.children
  }
}

function ErrorFallbackView({ onRetry, onGoHome }: { onRetry: () => void; onGoHome: () => void }) {
  const { t } = useI18n()
  return (
    <main className="min-vh-100 d-flex align-items-center justify-content-center bg-light text-dark p-4">
      <section className="bg-white border rounded-3 shadow-sm p-4" style={{ maxWidth: 520 }}>
        <h1 className="h5 fw-bold mb-2">{t('auth.unexpectedUiErrorTitle')}</h1>
        <p className="text-muted mb-3">{t('auth.unexpectedUiErrorDescription')}</p>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={onRetry}>{t('common.retry')}</button>
          <button type="button" className="btn btn-outline-secondary" onClick={onGoHome}>{t('common.goHome')}</button>
          <button type="button" className="btn btn-link text-secondary" onClick={() => window.location.reload()}>{t('common.reload')}</button>
        </div>
      </section>
    </main>
  )
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection', event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </I18nProvider>
  </StrictMode>,
)
