export const isValidUUID = (id: string | null | undefined): id is string => {
  if (!id) return false
  return /^[0-9a-f]{32}$/i.test(id) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}
