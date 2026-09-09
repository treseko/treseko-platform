// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { FirstRunOnboarding } from './FirstRunOnboarding'
import { ADMIN_GUIDE_OPEN_EVENT } from './onboardingEvents'

afterEach(cleanup)

describe('FirstRunOnboarding', () => {
  it('explica las diferencias de Treseko según la herramienta actual', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ completed: true, requires_onboarding: false }),
    } as Response)

    render(
      <I18nProvider>
        <FirstRunOnboarding
          loggedUser={{ role: 'ADMIN', profileSettings: {} }}
          fetchWithAuth={fetchWithAuth}
          onPreferencesUpdated={vi.fn()}
          firstRunState={{ requires_onboarding: true }}
          onFirstRunCompleted={vi.fn()}
          systemEdition="community"
        />
      </I18nProvider>,
    )

    expect(await screen.findByText('Four answers help us configure Treseko for the way you work.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Manual QA|QA manual/i }))
    fireEvent.click(screen.getByRole('button', { name: '1-5' }))
    fireEvent.click(screen.getByRole('button', { name: 'manage cases' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jira' }))
    fireEvent.click(screen.getByLabelText('I accept Treseko terms and conditions.'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'First understand where everything lives' })).toBeTruthy()
    expect(screen.getByText('Select an item to open its creation or management area.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Project/ })).toBeTruthy()
    expect(screen.getByLabelText('Step 1 of 4')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Different tests, one workflow' })).toBeTruthy()
    expect(screen.getByText('What makes us different')).toBeTruthy()
    expect(screen.getByText(/Keep incident tracking while adding QA context/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Bugs start with evidence' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Reports built for decisions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
  })

  it('permite reabrir la guía solo para el administrador', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profile_settings: { product_guide_seen: true } }),
    } as Response)

    render(
      <I18nProvider>
        <FirstRunOnboarding
          loggedUser={{ role: 'ADMIN', profileSettings: { product_guide_seen: true } }}
          fetchWithAuth={fetchWithAuth}
          onPreferencesUpdated={vi.fn()}
          firstRunState={{ requires_onboarding: false }}
          onFirstRunCompleted={vi.fn()}
          systemEdition="community"
        />
      </I18nProvider>,
    )

    window.dispatchEvent(new Event(ADMIN_GUIDE_OPEN_EVENT))

    expect(await screen.findByRole('heading', { name: 'First understand where everything lives' })).toBeTruthy()
    expect(screen.getByText('This guide is available only to administrators and can be reopened from Help.')).toBeTruthy()
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })

  it('permite omitir la guía y la marca como vista', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ completed: true, requires_onboarding: false }),
    } as Response)

    render(
      <I18nProvider>
        <FirstRunOnboarding
          loggedUser={{ role: 'ADMIN', profileSettings: {} }}
          fetchWithAuth={fetchWithAuth}
          onPreferencesUpdated={vi.fn()}
          firstRunState={{ requires_onboarding: true }}
          onFirstRunCompleted={vi.fn()}
          systemEdition="community"
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Manual QA|QA manual/i }))
    fireEvent.click(screen.getByRole('button', { name: '1-5' }))
    fireEvent.click(screen.getByRole('button', { name: /manage cases|gestionar casos/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Jira' }))
    fireEvent.click(screen.getByLabelText(/I accept Treseko terms|Acepto los términos/i))
    fireEvent.click(screen.getByRole('button', { name: /Continue|Continuar/i }))

    expect(await screen.findByRole('button', { name: /Skip guide|Omitir guía/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Skip guide|Omitir guía/i }))

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining('/users/me/preferences'),
      expect.objectContaining({ method: 'PATCH' }),
    ))
    expect(screen.queryByRole('heading', { name: /First understand where everything lives|Primero entiende dónde vive cada cosa/i })).toBeNull()
  })

  it('no abre la guía desde ayuda para un usuario no administrador', () => {
    render(
      <I18nProvider>
        <FirstRunOnboarding
          loggedUser={{ role: 'QA', profileSettings: { product_guide_seen: true } }}
          fetchWithAuth={vi.fn()}
          onPreferencesUpdated={vi.fn()}
          firstRunState={{ requires_onboarding: false }}
          onFirstRunCompleted={vi.fn()}
          systemEdition="community"
        />
      </I18nProvider>,
    )

    window.dispatchEvent(new Event(ADMIN_GUIDE_OPEN_EVENT))

    expect(screen.queryByRole('heading', { name: 'First understand where everything lives' })).toBeNull()
  })

  it('cierra el onboarding después de la encuesta para un usuario no administrador', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ completed: true, requires_onboarding: false }),
    } as Response)

    render(
      <I18nProvider>
        <FirstRunOnboarding
          loggedUser={{ role: 'QA', profileSettings: {} }}
          fetchWithAuth={fetchWithAuth}
          onPreferencesUpdated={vi.fn()}
          firstRunState={{ requires_onboarding: true }}
          onFirstRunCompleted={vi.fn()}
          systemEdition="community"
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Manual QA|QA manual/i }))
    fireEvent.click(screen.getByRole('button', { name: '1-5' }))
    fireEvent.click(screen.getByRole('button', { name: /manage cases|gestionar casos/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Jira' }))
    fireEvent.click(screen.getByLabelText(/I accept Treseko terms|Acepto los términos/i))
    fireEvent.click(screen.getByRole('button', { name: /Continue|Continuar/i }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'First understand where everything lives' })).toBeNull())
    expect(screen.queryByText('Four answers help us configure Treseko for the way you work.')).toBeNull()
  })
})
