import type { CalendarPresentation } from '@/shared/Calendar/Types/calendar-presentation.types.ts'

export interface UtcDateTimeRangeValue {
    readonly from: string
    readonly to: string
}

export interface UtcDateTimeRangeInputProps {
    readonly ariaLabel: string
    readonly describedBy?: string | undefined
    readonly disabled?: boolean | undefined
    readonly invalid?: boolean | undefined
    readonly onValueChange: (value: UtcDateTimeRangeValue) => void
    readonly value: UtcDateTimeRangeValue
}

export interface UtcDateTimeRangeInputLogic {
    readonly state: {
        readonly range: readonly [string | null, string | null] | null
        readonly presentation: CalendarPresentation
    }
    readonly handler: {
        readonly handleRangeChange: (range: [string | null, string | null] | undefined) => void
    }
}
