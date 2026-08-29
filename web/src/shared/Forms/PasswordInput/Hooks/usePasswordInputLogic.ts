import { useState } from 'react'
import type { MouseEvent } from 'react'

export default function usePasswordInputLogic() {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false)

    return {
        state: {
            inputType: isPasswordVisible ? ('text' as const) : ('password' as const),
            isPasswordVisible,
            toggleLabel: isPasswordVisible ? 'Hide password' : 'Show password',
        },
        handler: {
            keepInputFocused: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
            toggleVisibility: () => setIsPasswordVisible((isVisible) => !isVisible),
        },
    }
}
