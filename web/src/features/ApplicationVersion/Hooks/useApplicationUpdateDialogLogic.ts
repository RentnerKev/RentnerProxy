import { useState } from 'react'

import { APP_VERSION } from '@/lib/ApplicationVersion/version.ts'
import type {
    ApplicationUpdateDialogLogicResult,
    ApplicationUpdateDialogProps,
} from '../Types/application-update-dialog.types.ts'

export default function useApplicationUpdateDialogLogic(
    data: ApplicationUpdateDialogProps['data'],
): ApplicationUpdateDialogLogicResult {
    const reference = data?.latest?.image.status === 'verified' ? data.latest.image.reference : null
    const [copiedReference, setCopiedReference] = useState<string | null>(null)
    const [failedReference, setFailedReference] = useState<string | null>(null)
    const releaseUrl = data?.latest?.url
    const isOfficialUrl = releaseUrl?.startsWith(
        'https://github.com/RentnerKev/RentnerProxy/releases/',
    )
    const copyReference = async () => {
        if (!reference) return
        try {
            await navigator.clipboard.writeText(reference)
            setCopiedReference(reference)
            setFailedReference(null)
        } catch {
            setCopiedReference(null)
            setFailedReference(reference)
        }
    }

    return {
        state: {
            currentVersion: APP_VERSION,
            releaseUrl: isOfficialUrl
                ? releaseUrl!
                : 'https://github.com/RentnerKev/RentnerProxy/releases',
            canCopy: reference !== null,
            copyState:
                reference && copiedReference === reference
                    ? 'copied'
                    : reference && failedReference === reference
                      ? 'failed'
                      : 'idle',
        },
        handler: {
            handleCopy: () => {
                void copyReference()
            },
        },
    }
}
