import type { CalendarCustomDesign } from '@rentnerkev/calendar/types'

export const CALENDAR_TRIGGER_CLASS_NAME = 'text-left'

export const CALENDAR_CUSTOM_DESIGN = {
    primaryColor: 'text-accent-foreground',
    primaryColorFocusWithin: 'group-focus-within:text-accent-foreground',
    primaryBg: 'bg-accent',
    primaryHover: 'hover:bg-accent-hover',
    primaryBorder: 'border-accent-border',
    primaryFocusBorder: 'focus:border-accent-border',
    primaryRing: 'focus:ring-accent-ring/20',
    primaryBgSubtle: 'bg-accent-muted',
    surfaceBackground: 'bg-surface-raised',
    inputBackground: 'bg-surface-raised',
    borderColor: 'border-input-border',
    borderTransparent: 'border-transparent',
    textColor: 'text-ink',
    textMuted: 'text-muted',
    textMutedDark: 'text-muted-soft',
    textDisabled: 'text-muted-soft/55',
    textDay: 'text-ink-soft',
    textBackground: 'text-accent-foreground',
    hoverBackground: 'hover:bg-surface-hover',
    hoverText: 'hover:text-accent-ring',
    hoverTextMuted: 'hover:text-muted',
} satisfies CalendarCustomDesign
