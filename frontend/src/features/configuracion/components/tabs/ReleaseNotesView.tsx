import type { ReleaseNoteGroup } from './releaseNotes'

export function ReleaseNotesView({ groups, fallback }: { groups: ReleaseNoteGroup[]; fallback: string }) {
  if (!groups.length) return <div className="small text-muted text-break">{fallback}</div>

  return (
    <div className="small text-muted d-grid gap-2 text-break">
      {groups.map(group => (
        <div key={group.title}>
          <div className="fw-bold text-dark mb-1">{group.title}</div>
          <ul className="mb-0 ps-3">
            {group.items.map((item, index) => <li key={`${group.title}-${index}`}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}
