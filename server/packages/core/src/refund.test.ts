import { describe, expect, it } from 'vitest'
import { refundedLicense } from './store.js'

const day=86400000
const now=new Date('2026-09-26T12:00:00Z')
const at=(days:number)=>new Date(now.getTime()+days*day)

describe('refundedLicense',()=>{
  it('takes back only the unused part of a fixed-term grant',()=>{
    // 30-day order bought 10 days ago on an empty license: 20 days unused
    const r=refundedLicense({expiresAt:at(20),lifetime:false},{startAt:at(-10),endAt:at(20),beforeExpiresAt:null,beforeLifetime:false},now)
    expect(r).toEqual({expiresAt:now,lifetime:false,removedDays:20})
  })

  it('moves later stacked grants up by the refunded length',()=>{
    // renewal queued after the current term: it has not started, remove all 30 days
    const r=refundedLicense({expiresAt:at(65),lifetime:false},{startAt:at(5),endAt:at(35),beforeExpiresAt:at(5),beforeLifetime:false},now)
    expect(r?.expiresAt).toEqual(at(35))
    expect(r?.removedDays).toBe(30)
  })

  it('removes nothing when the grant is already used up (a lapse and a later grant must not be charged)',()=>{
    const r=refundedLicense({expiresAt:at(25),lifetime:false},{startAt:at(-90),endAt:at(-60),beforeExpiresAt:null,beforeLifetime:false},now)
    expect(r).toBeNull()
  })

  it('reverts a lifetime grant to the license before it',()=>{
    const r=refundedLicense({expiresAt:new Date('2999-12-31T23:59:59Z'),lifetime:true},{startAt:at(-1),endAt:null,beforeExpiresAt:at(12),beforeLifetime:false},now)
    expect(r).toEqual({expiresAt:at(12),lifetime:false,removedDays:-1})
  })

  it('keeps a lifetime license that came from another grant',()=>{
    expect(refundedLicense({expiresAt:new Date('2999-12-31T23:59:59Z'),lifetime:true},{startAt:at(-5),endAt:at(25),beforeExpiresAt:null,beforeLifetime:false},now)).toBeNull()
    expect(refundedLicense({expiresAt:new Date('2999-12-31T23:59:59Z'),lifetime:true},{startAt:at(-5),endAt:null,beforeExpiresAt:null,beforeLifetime:true},now)).toBeNull()
  })
})
