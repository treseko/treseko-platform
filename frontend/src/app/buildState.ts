export type BuildLike = {
  active?: boolean
  state?: string
}

/** Historical builds are inspectable but immutable; preparation builds remain editable until activation. */
export function isBuildReadOnly(build?: BuildLike | null): boolean {
  if (!build) return false
  if (build.state === 'HISTORICA') return true

  // Keep the legacy shape safe: an inactive build without an explicit state
  // is historical, while PREPARACION is an editable draft awaiting activation.
  return !build.state && build.active === false
}
