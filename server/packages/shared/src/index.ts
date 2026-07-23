export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message) }
}
export const nowIso = () => new Date().toISOString()
export const normalizeUsername = (value: string) => value.trim().toLowerCase()
