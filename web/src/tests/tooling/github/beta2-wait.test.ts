import { expect, mock, test } from 'bun:test'
import { waitForBeta2 } from '../../../../../.github/scripts/ci/beta2/wait.ts'

test.each(['startup aborted', 'exited before readiness'])(
    'readiness propagates %s immediately without replacing or retrying the error',
    async (reason) => {
        const failure = new Error('Beta 2 controller ' + reason)
        const check = mock(async () => {
            throw failure
        })
        const retryOnError = mock(() => false)

        await expect(waitForBeta2(check, 'controller readiness', 1_000, retryOnError)).rejects.toBe(
            failure,
        )

        expect(check).toHaveBeenCalledTimes(1)
        expect(retryOnError).toHaveBeenCalledTimes(1)
        expect(retryOnError).toHaveBeenCalledWith(failure)
    },
)

test('readiness still polls false results when predicate errors are terminal', async () => {
    let attempts = 0
    const retryOnError = mock(() => false)
    await waitForBeta2(async () => ++attempts === 2, 'controller readiness', 1_000, retryOnError)

    expect(attempts).toBe(2)
    expect(retryOnError).not.toHaveBeenCalled()
})

test('ordinary Beta 2 waits retain their default retry of transient predicate errors', async () => {
    let attempts = 0
    await waitForBeta2(
        async () => {
            if (++attempts === 1) throw new Error('transient receiver failure')
            return true
        },
        'receiver readiness',
        1_000,
    )

    expect(attempts).toBe(2)
})
