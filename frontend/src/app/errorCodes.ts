export const ERROR_CODES = {
  BACKEND_UNAVAILABLE: 'QA-BE-UNAVAILABLE',
  REAL_MODE_LOCAL_WRITE_DISABLED: 'QA-REAL-MODE',
  PROJECT_CREATE_FAILED: 'QA-PROJECT-CREATE-FAILED',
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

export const formatAppError = (code: ErrorCode, message: string) => `${code}: ${message}`
