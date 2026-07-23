import { z } from 'zod'

export const deviceSchema = z.object({
  fingerprint: z.string().min(32).max(128),
  name: z.string().trim().min(1).max(80),
  platform: z.literal('windows'),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
})
export const loginSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(8).max(256), device: deviceSchema })
export const refreshSchema = z.object({ refreshToken: z.string().min(40), deviceFingerprint: z.string().min(32).max(128) })
export const leaseSchema = z.object({ deviceFingerprint: z.string().min(32).max(128), appVersion: z.string().min(5).max(40) })
export const userCreateSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(10).max(256), role: z.enum(['user','admin']).default('user'), planId: z.string().uuid().optional(), days: z.number().int().min(1).max(3650).default(30) })
export const userStatusSchema = z.object({ status: z.enum(['active','suspended','banned']) })
export const licenseExtendSchema = z.object({ days: z.number().int().min(1).max(3650) })
export const releaseCreateSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/), url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().min(32), mandatory: z.boolean().default(false) })
export type LoginInput = z.infer<typeof loginSchema>
export type DeviceInput = z.infer<typeof deviceSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type LeaseInput = z.infer<typeof leaseSchema>
