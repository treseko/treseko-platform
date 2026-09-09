export const ADMIN_GUIDE_OPEN_EVENT = 'treseko:open-admin-product-guide'
export const ADMIN_GUIDE_ACTION_EVENT = 'treseko:admin-product-guide-action'

export type AdminGuideAction =
  | 'solution'
  | 'project'
  | 'component'
  | 'build'
  | 'suite'
  | 'case'
  | 'execution'
  | 'evidence'
  | 'bug'
  | 'report'

export function requestAdminGuideOpen() {
  window.dispatchEvent(new Event(ADMIN_GUIDE_OPEN_EVENT))
}

export function requestAdminGuideAction(action: AdminGuideAction) {
  window.dispatchEvent(new CustomEvent(ADMIN_GUIDE_ACTION_EVENT, { detail: { action } }))
}
