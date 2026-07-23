import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const userStatus = pgEnum('user_status', ['active','suspended','banned'])
export const userRole = pgEnum('user_role', ['user','admin'])
export const licenseStatus = pgEnum('license_status', ['active','paused','revoked','expired'])

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(), name: text('name').notNull().unique(),
  maxDevices: integer('max_devices').notNull().default(1), features: jsonb('features').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
})
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(), username: text('username').notNull().unique(), passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('user'), status: userStatus('status').notNull().default('active'), note: text('note').notNull().default(''),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
})
export const licenses = pgTable('licenses', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  planId: uuid('plan_id').notNull().references(()=>plans.id), status: licenseStatus('status').notNull().default('active'),
  startsAt: timestamp('starts_at',{withTimezone:true}).notNull().defaultNow(), expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
})
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  fingerprintHash: text('fingerprint_hash').notNull(), name: text('name').notNull(), platform: text('platform').notNull(), appVersion: text('app_version').notNull(),
  revoked: boolean('revoked').notNull().default(false), firstSeenAt: timestamp('first_seen_at',{withTimezone:true}).notNull().defaultNow(), lastSeenAt: timestamp('last_seen_at',{withTimezone:true}).notNull().defaultNow(),
})
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}), deviceId: uuid('device_id').notNull().references(()=>devices.id,{onDelete:'cascade'}),
  familyId: uuid('family_id').notNull(), jti: uuid('jti').notNull().unique(), tokenHash: text('token_hash').notNull(), consumedAt: timestamp('consumed_at',{withTimezone:true}),
  revokedAt: timestamp('revoked_at',{withTimezone:true}), expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
})
export const releases = pgTable('releases', {
  id: uuid('id').primaryKey().defaultRandom(), version: text('version').notNull().unique(), minimumVersion: text('minimum_version').notNull(), url: text('url').notNull(),
  sha256: text('sha256').notNull(), signature: text('signature').notNull(), mandatory: boolean('mandatory').notNull().default(false), publishedAt: timestamp('published_at',{withTimezone:true}).notNull().defaultNow(),
})
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(), actorUserId: uuid('actor_user_id').references(()=>users.id), action: text('action').notNull(), targetType: text('target_type').notNull(), targetId: text('target_id').notNull(),
  ip: text('ip').notNull().default(''), result: text('result').notNull(), metadata: jsonb('metadata').$type<Record<string,unknown>>().notNull().default({}), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
})
