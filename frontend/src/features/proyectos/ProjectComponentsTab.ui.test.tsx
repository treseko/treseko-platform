import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ProjectComponentsTab } from './ProjectComponentsTab'

const components = [
  { id: 'component-web', projectId: 'project-1', name: 'Web Storefront', description: 'Web' },
  { id: 'component-api', projectId: 'project-1', name: 'Checkout API', description: 'API' },
]

const builds = [
  { id: 'build-web', projectId: 'project-1', componentId: 'component-web', name: 'Web build', state: 'ACTIVA', active: true },
  { id: 'build-api', projectId: 'project-1', componentId: 'component-api', name: 'API build', state: 'PREPARACION', active: false },
]

function TestHarness() {
  const [currentCompId, setCurrentCompId] = useState('component-web')
  return (
    <ProjectComponentsTab
      context={{
        t: (key: string) => key,
        canReadProjectComponents: true,
        canReadProjectBuilds: true,
        canReadProjectBuildScope: true,
        canEditProjectComponentsEffective: false,
        canEditProjectBuildsEffective: false,
        componentsList: components,
        buildsList: builds,
        managingProjectId: 'project-1',
        currentCompId,
        handleComponentChange: (componentId: string) => setCurrentCompId(componentId),
        componentSearchQuery: '',
        setComponentSearchQuery: () => {},
        setComponentForm: () => {},
        handleDeleteComponent: () => {},
        setShowComponentModal: () => {},
        showBuildCreateOptions: false,
        setShowBuildCreateOptions: () => {},
        defaultBuildStartDate: '',
        sortBuildsNewestFirst: (items: any[]) => items,
        buildWindowState: () => ({ label: '' }),
        expandedBuildDetails: {},
        setExpandedBuildDetails: () => {},
        latestBuildReports: {},
        reportCacheKey: () => '',
        latestReportStatus: () => null,
        firstUrlFromText: () => '',
        formatDateTime: () => '',
        reportSnapshotsEnabled: false,
        canViewSharedReports: false,
        openBuildCasesModal: () => {},
        buildCaseIds: {},
        openProjectReportLink: () => {},
        reportButtonLabel: () => '',
        goToReports: () => {},
        hasSystemFeature: () => false,
        handleToggleBuildHidden: () => {},
        handleSetInactiveBuild: () => {},
        handleSetActiveBuild: () => {},
        handleDeleteBuild: () => {},
        handleUpdateBuildContext: () => {},
        toDateTimeLocalInput: () => '',
      }}
    />
  )
}

describe('ProjectComponentsTab', () => {
  it('changes component and shows the selected component builds', () => {
    render(<TestHarness />)

    expect(screen.getByRole('heading', { name: 'Web Storefront' })).toBeTruthy()
    expect(screen.getByText('Web build')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Checkout API/ }))

    expect(screen.getByRole('heading', { name: 'Checkout API' })).toBeTruthy()
    expect(screen.getByText('API build')).toBeTruthy()
    expect(screen.queryByText('Web build')).toBeNull()
  })
})
