// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from './i18n'
import { SuiteTree } from './SuiteTree'

afterEach(cleanup)

const suite = { id: 'suite-1', nombre: 'API QA - HTTPBin', children: [] }

function renderTree(openSuiteDropdown: string | null) {
  return render(
    <I18nProvider>
      <SuiteTree
        suites={[suite]}
        expandedSuites={{ 'suite-1': true }}
        selectedSuiteId="suite-1"
        selectedSubSuiteId={null}
        selectedTest={null}
        casosList={[{ id: 'case-1', suiteId: 'suite-1', componentId: 'component-1', title: 'Caso' }]}
        currentCompId="component-1"
        testSearchQuery=""
        onSelectSuite={vi.fn()}
        onToggleSuite={vi.fn()}
        onCreateCase={vi.fn()}
        onCreateSuite={vi.fn()}
        onEditSuite={vi.fn()}
        onCloneSuite={vi.fn()}
        onDeleteSuite={vi.fn()}
        onSelectTest={vi.fn()}
        onEditCase={vi.fn()}
        onDeleteCase={vi.fn()}
        openSuiteDropdown={openSuiteDropdown}
        onToggleSuiteDropdown={vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('SuiteTree suite action tooltip', () => {
  it('oculta el tooltip nativo mientras el menú de acciones está abierto', () => {
    const { container } = renderTree('suite-1')
    const row = container.querySelector('.suite-tree-suite-row')
    const name = container.querySelector('.suite-tree-suite-row > .app-small')

    expect(row).not.toHaveAttribute('title')
    expect(name).not.toHaveAttribute('title')
    expect(row).toHaveAttribute('aria-label', expect.stringContaining('API QA - HTTPBin'))
  })

  it('conserva el tooltip cuando el menú está cerrado', () => {
    const { container } = renderTree(null)
    const row = container.querySelector('.suite-tree-suite-row')

    expect(row).toHaveAttribute('title', expect.stringContaining('API QA - HTTPBin'))
  })
})
