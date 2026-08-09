export function needsForcedPasswordChange(profileSettings: any) {
  return profileSettings?.security?.force_password_change === true
}
