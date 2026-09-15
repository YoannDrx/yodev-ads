import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ databases: [] as unknown[] }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_:unknown,action:(db:unknown)=>Promise<unknown>)=>action(mocks.databases.shift()),withSystemTransaction:async(action:(db:unknown)=>Promise<unknown>)=>action(mocks.databases.shift()) }))
import { getPortfolioWorkload } from './portfolio-workload'
function db(workspace:unknown,...statementResults:unknown[]) { mocks.databases.push(databaseDouble({statementResults,query:{workspaces:{findFirst:async()=>workspace}}}).db) }
beforeEach(()=>{mocks.databases.length=0})
describe('portfolio team workload',()=>{
  it('denies unreadable workspaces before global identity access',async()=>{
    for(const workspace of [undefined,{accessState:'suspended'}]) {db(workspace);expect(await getPortfolioWorkload('workspace')).toEqual([])}
  })
  it('keeps unassigned and former-member tasks and adds idle agency members',async()=>{
    db({accessState:'grace'},{rows:[{userId:'former',open:2,blocked:1,overdue:1,urgent:0,active:0},{userId:'busy',open:1,blocked:0,overdue:0,urgent:1,active:1}]})
    db({authOrganizationId:'org',ownerUserId:'idle'},[{userId:'busy',name:'Busy member',role:'strategist'},{userId:'idle',name:'Owner',role:'client'},{userId:'client',name:'Client',role:'client'}])
    const result=await getPortfolioWorkload('workspace')
    expect(result[0]).toMatchObject({userId:'former',name:null,open:2})
    expect(result.find(row=>row.userId==='busy')?.name).toBe('Busy member')
    expect(result.find(row=>row.userId==='idle')?.open).toBe(0)
    expect(result.some(row=>row.userId==='client')).toBe(false)
    expect(result.some(row=>row.userId===null)).toBe(true)
  })
  it('reads unassigned tasks without inventing a member profile',async()=>{
    db({accessState:'active'},{rows:[{userId:null,open:1,blocked:0,overdue:0,urgent:0,active:0}]});db(undefined)
    expect(await getPortfolioWorkload('workspace')).toEqual([{userId:null,name:null,open:1,blocked:0,overdue:0,urgent:0,active:0}])
  })
})
