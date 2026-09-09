import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_REPORT_SETTINGS, PROJECT_REPORT_SETTING_GROUPS, mergeProjectReportSettings } from './reportesViewConfig'

describe('development report settings', () => {
  it('offers results, current findings, pending history and verified fixes separately', () => {
    const fields = Object.fromEntries(PROJECT_REPORT_SETTING_GROUPS.development.map(item => [item.id, item.label]))
    expect(fields.summary).toBe('versionResultsSummary')
    expect(fields.bugs).toBe('newVersionBugs')
    expect(fields.bug_tracking).toBe('pendingHistoricalBugs')
    expect(fields.corrected_bugs).toBe('verifiedBugFixes')
    expect(fields.failures).toBe('unlinkedFailures')
    expect(fields).not.toHaveProperty('regressions')
  })

  it('keeps detailed distributions optional and preserves saved choices', () => {
    expect(DEFAULT_PROJECT_REPORT_SETTINGS.development.sections.distribution).toBe(false)
    expect(DEFAULT_PROJECT_REPORT_SETTINGS.development.sections.format_metrics).toBe(false)
    const settings = mergeProjectReportSettings({ development: { sections: {
      bugs: false, corrected_bugs: false, regressions: false,
    } } })
    expect(settings.development.sections.bugs).toBe(false)
    expect(settings.development.sections.corrected_bugs).toBe(false)
    expect(settings.development.sections.regressions).toBe(false)
    expect(settings.development.sections.bug_tracking).toBe(true)
    expect(settings.internal.sections.cases).toBe(true)
  })
})
