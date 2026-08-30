import { useState } from 'react'
import type { MouseEvent } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'

export default function usePasswordInputLogic() {
    const { t } = useTranslationStore()
    const [isPasswordVisible, setIsPasswordVisible] = useState(false)

    return {
        state: {
            inputType: isPasswordVisible ? ('text' as const) : ('password' as const),
            isPasswordVisible,
            toggleLabel: t(isPasswordVisible ? 'common.hidePassword' : 'common.showPassword'),
        },
        handler: {
            keepInputFocused: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
            toggleVisibility: () => setIsPasswordVisible((isVisible) => !isVisible),
        },
    }
}
