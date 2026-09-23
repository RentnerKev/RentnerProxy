import type { CrowdSecConfiguration } from '../../../shared/Types/crowdsec.types'
import type { CrowdSecTransitionMode, CrowdSecTransitionProgress } from './Types/crowdsec.types'

export function getCrowdSecTransitionProgress(
    targetMode: CrowdSecTransitionMode,
    configuration: CrowdSecConfiguration | undefined,
    observedAt: number,
    startedAt: number,
): CrowdSecTransitionProgress {
    const saved = observedAt >= startedAt && configuration?.mode === targetMode
    const runtime = saved ? configuration.runtime : null
    const healthDegraded = runtime?.state === 'degraded' || runtime?.managedEngine === 'degraded'

    if (targetMode === 'managed') {
        const engineStarting =
            runtime?.managedEngine === 'starting' || runtime?.managedEngine === 'restarting'
        const engineReady = runtime?.managedEngine === 'ready'
        const proxySwitched = runtime?.mode === 'managed' && runtime.enforcementActive
        const complete =
            proxySwitched &&
            engineReady &&
            runtime.state === 'connected' &&
            configuration?.synchronized === true

        return {
            percent: complete
                ? 100
                : proxySwitched
                  ? 85
                  : engineReady
                    ? 70
                    : engineStarting
                      ? 50
                      : saved
                        ? 30
                        : 0,
            activeStep: complete ? 4 : proxySwitched ? 3 : engineReady ? 2 : saved ? 1 : 0,
            complete,
            healthDegraded,
        }
    }

    const proxySwitched = runtime?.mode === 'disabled' && !runtime.enforcementActive
    const engineStopped = proxySwitched && runtime.managedEngine === 'stopped'
    const complete = engineStopped && configuration?.synchronized === true
    return {
        percent: complete ? 100 : engineStopped ? 90 : proxySwitched ? 75 : saved ? 30 : 0,
        activeStep: complete ? 4 : engineStopped ? 3 : proxySwitched ? 2 : saved ? 1 : 0,
        complete,
        healthDegraded,
    }
}
