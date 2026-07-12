export type BrandingState = {
  edition: 'community' | 'premium'
  can_customize?: boolean
  brand_name?: string
  logo_url?: string | null
  enabled?: boolean
  effective_brand_name: string
  effective_logo_url: string
  custom_branding_active: boolean
}

export const DEFAULT_BRANDING: BrandingState = {
  edition: 'community',
  can_customize: false,
  brand_name: 'Treseko',
  logo_url: null,
  enabled: false,
  effective_brand_name: 'Treseko',
  effective_logo_url: '/gecko-community-icon.png?v=3',
  custom_branding_active: false,
}

export const normalizeBrandingState = (value: Partial<BrandingState> | null | undefined): BrandingState => {
  const effectiveBrandName = String(value?.effective_brand_name || value?.brand_name || DEFAULT_BRANDING.effective_brand_name).trim() || DEFAULT_BRANDING.effective_brand_name
  const effectiveLogoUrl = String(value?.effective_logo_url || value?.logo_url || DEFAULT_BRANDING.effective_logo_url).trim() || DEFAULT_BRANDING.effective_logo_url
  return {
    ...DEFAULT_BRANDING,
    ...value,
    edition: value?.edition === 'premium' ? 'premium' : 'community',
    effective_brand_name: effectiveBrandName,
    effective_logo_url: effectiveLogoUrl,
    custom_branding_active: Boolean(value?.custom_branding_active),
  }
}
