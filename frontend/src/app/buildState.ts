export type BuildLike = {
  active?: boolean
  state?: string
}

/** Historical and preparation builds are inspectable but immutable. */
export function isBuildReadOnly(build?: BuildLike | null): boolean {
  return Boolean(build && (build.active !== true || build.state !== 'ACTIVA'))
}
