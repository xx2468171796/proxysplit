import { describe, expect, it } from 'vitest'
import { resolvePaidLicenseGrant } from './store.js'

describe('paid license grant calculation',()=>{
  const now=new Date('2026-07-24T00:00:00.000Z')

  it('extends an active fixed-term entitlement from its current expiry',()=>{
    const result=resolvePaidLicenseGrant(
      {planId:'old-plan',expiresAt:new Date('2026-08-01T00:00:00.000Z'),lifetime:false},
      {planId:'month-plan',durationDays:30,lifetime:false},now,
    )
    expect(result).toEqual({
      planId:'month-plan',expiresAt:new Date('2026-08-31T00:00:00.000Z'),lifetime:false,changed:true,
    })
  })

  it('never downgrades or relabels an existing lifetime entitlement',()=>{
    const expiresAt=new Date('2999-12-31T23:59:59.000Z')
    const result=resolvePaidLicenseGrant(
      {planId:'lifetime-plan',expiresAt,lifetime:true},
      {planId:'month-plan',durationDays:30,lifetime:false},now,
    )
    expect(result).toEqual({planId:'lifetime-plan',expiresAt,lifetime:true,changed:false})
  })

  it('rejects a paid fixed-term order without a valid duration',()=>{
    expect(()=>resolvePaidLicenseGrant(null,{planId:'broken-plan',durationDays:null,lifetime:false},now))
      .toThrow('ORDER_DURATION_INVALID')
  })
})
