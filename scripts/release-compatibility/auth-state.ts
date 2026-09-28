import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'

import type { Alpha1UpgradeFixture, Command } from '../alpha1-upgrade-fixture'
import { decodeApplicationKey } from '../alpha4-persistence/crypto'
import { psql, readContainerFile, sqlQuote } from '../alpha4-persistence/storage'

export interface AuthFixture {
    readonly sessionId: string
    readonly sessionTokenHash: string
    readonly recoveryId: string
    readonly recoveryHash: string
    readonly passkeyId: string
    readonly credentialId: string
    readonly publicKeyHex: string
    readonly totpId: string
    readonly totpSecret: string
    readonly ciphertextHex: string
    readonly ivHex: string
}

export async function seedAuthFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly base: Alpha1UpgradeFixture
}): Promise<AuthFixture> {
    const sessionId = randomUUID()
    const sessionTokenHash = createHash('sha256')
        .update(`compat-session-${input.base.runId}`)
        .digest('hex')
    const recoveryId = randomUUID()
    const recoveryHash = createHash('sha256')
        .update(`compat-recovery-${input.base.runId}`)
        .digest('hex')
    const passkeyId = randomUUID()
    const credentialId = `compat-passkey-${input.base.runId}`
    const publicKeyHex = 'a4010103272006215820' + 'a1'.repeat(32)
    const totpId = randomUUID()
    const totpSecret = 'JBSWY3DPEHPK3PXP'
    const encodedKey = (
        await readContainerFile(input.command, input.containerId, '/run/rentnerproxy/app-key/value')
    ).trim()
    const key = decodeApplicationKey(encodedKey).bytes
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(`rentnerproxy:totp:${input.base.customUserId}`, 'utf8'))
    const ciphertext = Buffer.concat([
        cipher.update(totpSecret, 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
    ])
    const ciphertextHex = ciphertext.toString('hex')
    const ivHex = iv.toString('hex')
    await psql(
        input.command,
        input.containerId,
        `begin;
insert into rentnerproxy.sessions (id,user_id,token_hash,expires_at) values
(${sqlQuote(sessionId)},${sqlQuote(input.base.adminUserId)},${sqlQuote(sessionTokenHash)},now()+interval '7 days');
insert into rentnerproxy.user_recovery_codes (id,user_id,code_hash) values
(${sqlQuote(recoveryId)},${sqlQuote(input.base.customUserId)},${sqlQuote(recoveryHash)});
insert into rentnerproxy.passkeys (id,user_id,name,credential_id,public_key,counter,transports,device_type,backed_up) values
(${sqlQuote(passkeyId)},${sqlQuote(input.base.customUserId)},'Upgrade fixture',${sqlQuote(credentialId)},decode(${sqlQuote(publicKeyHex)},'hex'),1,'["internal"]'::jsonb,'singleDevice',false);
insert into rentnerproxy.user_totp_factors (id,user_id,secret_ciphertext,secret_iv,last_used_counter) values
(${sqlQuote(totpId)},${sqlQuote(input.base.customUserId)},decode(${sqlQuote(ciphertextHex)},'hex'),decode(${sqlQuote(ivHex)},'hex'),4);
commit;`,
    )
    return {
        sessionId,
        sessionTokenHash,
        recoveryId,
        recoveryHash,
        passkeyId,
        credentialId,
        publicKeyHex,
        totpId,
        totpSecret,
        ciphertextHex,
        ivHex,
    }
}

export async function assertAuthFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly base: Alpha1UpgradeFixture
    readonly fixture: AuthFixture
}): Promise<void> {
    const f = input.fixture
    const output = await psql(
        input.command,
        input.containerId,
        `select row_to_json(t) from (select
        (select count(*) from rentnerproxy.sessions where id=${sqlQuote(f.sessionId)} and user_id=${sqlQuote(input.base.adminUserId)} and token_hash=${sqlQuote(f.sessionTokenHash)}) as sessions,
        (select count(*) from rentnerproxy.user_recovery_codes where id=${sqlQuote(f.recoveryId)} and user_id=${sqlQuote(input.base.customUserId)} and code_hash=${sqlQuote(f.recoveryHash)} and used_at is null) as recovery,
        (select count(*) from rentnerproxy.passkeys where id=${sqlQuote(f.passkeyId)} and user_id=${sqlQuote(input.base.customUserId)} and credential_id=${sqlQuote(f.credentialId)} and encode(public_key,'hex')=${sqlQuote(f.publicKeyHex)} and counter=1 and device_type='singleDevice') as passkeys,
        (select count(*) from rentnerproxy.user_totp_factors where id=${sqlQuote(f.totpId)} and user_id=${sqlQuote(input.base.customUserId)} and encode(secret_ciphertext,'hex')=${sqlQuote(f.ciphertextHex)} and encode(secret_iv,'hex')=${sqlQuote(f.ivHex)} and last_used_counter=4) as totp
    ) t`,
    )
    const state = JSON.parse(output) as Record<string, number>
    for (const key of ['sessions', 'recovery', 'passkeys', 'totp'])
        assert.equal(Number(state[key]), 1)
    const encodedKey = (
        await readContainerFile(input.command, input.containerId, '/run/rentnerproxy/app-key/value')
    ).trim()
    const key = decodeApplicationKey(encodedKey).bytes
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.ivHex, 'hex'))
    decipher.setAAD(Buffer.from(`rentnerproxy:totp:${input.base.customUserId}`, 'utf8'))
    const ciphertext = Buffer.from(f.ciphertextHex, 'hex')
    decipher.setAuthTag(ciphertext.subarray(-16))
    assert.equal(
        Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString(
            'utf8',
        ),
        f.totpSecret,
    )
}
