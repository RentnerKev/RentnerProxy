import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('session maintenance preserves authorization, audit and conditional last-seen updates', async () => {
    // Module mocks stay inside this child; other auth suites retain their real dependencies.
    const child = Bun.spawn({
        cmd: [
            process.execPath,
            '--no-env-file',
            '-e',
            `
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
const events = []
let recent = true, allowed = true, active = true, auditFailure = false
let updates = 0, transactions = 0
const userId = '00000000-0000-4000-8000-000000000001'
const transaction = {
    select(fields) {
        const rows = 'expiresAt' in fields
            ? [{ id:'session-id', userId, expiresAt:new Date(Date.now()+60_000), reauthenticatedAt:new Date(), lastSeenAt:new Date(Date.now()-(recent ? 0 : 3_600_000)) }]
            : [{ id:userId, status:active ? 'active' : 'disabled' }]
        const query = { from:()=>query, innerJoin:()=>query, where:()=>query, limit:()=>query, for:async()=>rows, then:(resolve)=>Promise.resolve(rows).then(resolve) }
        return query
    },
    insert() { return { values:()=>({ returning:async()=>[{id:'created-session'}] }) } },
    update() { updates++; return { set:()=>({ where:async()=>undefined }) } },
    execute:async()=>{events.push('cleanup')},
}
mock.module('@/server/Auth/Core/database.server.ts',()=>({getAuthDatabase:()=>({transaction:async(run)=>{transactions++;return run(transaction)}})}))
mock.module('@/server/Auth/Access/cookies.server.ts',()=>({getSessionCookie:()=>null}))
mock.module('@/server/Auth/Access/rbac.service.ts',()=>({resolveActiveUserAccessInTransaction:async()=>{events.push('access');return {id:userId,permissions:allowed ? ['app.access'] : []}}}))
mock.module('@/server/Audit/audit.service.ts',()=>({appendAuditEventInTransactionService:async(_tx,event)=>{events.push(event.action);if(auditFailure)throw new Error('fixture audit failure')}}))
const service = await import('./web/src/server/Auth/Access/sessions.service.ts')
const { PERMISSIONS } = await import('./web/src/config/permissions.config.ts')
assert.equal(PERMISSIONS.APP_ACCESS,'app.access')
const token = 'a'.repeat(43)
assert.equal(await service.getSessionByTokenService('invalid'),null)
assert.equal(transactions,0)
assert.ok(await service.getSessionByTokenService(token))
assert.equal(updates,0)
recent=false
assert.ok(await service.getSessionByTokenService(token))
assert.equal(updates,1)
allowed=false
assert.equal(await service.getSessionByTokenService(token),null)
assert.equal(updates,1)
events.length=0
await assert.rejects(service.createSessionService(userId),error=>error.code==='user_not_active')
assert.deepEqual(events,['access'])
allowed=true;active=false;events.length=0
await assert.rejects(service.createSessionService(userId),error=>error.code==='user_not_active')
assert.deepEqual(events,[])
active=true;events.length=0
const created=await service.createSessionService(userId)
assert.equal(created.id,'created-session')
assert.deepEqual(events,['access','cleanup','login'])
auditFailure=true;events.length=0
await assert.rejects(service.createSessionService(userId),/fixture audit failure/)
assert.deepEqual(events,['access','cleanup','login'])
console.log('PASS: invalid token stays read-free; recent touch skips UPDATE; denied users skip cleanup; authorized creation cleans once before unchanged audit; audit failure propagates')
`,
        ],
        cwd: resolve(import.meta.dir, '../../../../../..'),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    expect(exit, stderr).toBe(0)
    expect(stdout).toContain('PASS:')
})
