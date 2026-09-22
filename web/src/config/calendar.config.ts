import type { CalendarCustomDesign } from '@rentnerkev/calendar/types'

export const CALENDAR_TRIGGER_CLASS_NAME = 'text-left [&>span]:text-ink'

export const CALENDAR_CUSTOM_DESIGN = {
    primaryColor: 'text-brand-text',
    primaryColorFocusWithin: 'group-focus-within:text-brand-text',
    primaryBg: 'bg-brand-500',
    primaryHover: 'hover:bg-brand-600',
    primaryBorder: 'border-brand-600',
    primaryFocusBorder: 'focus:border-brand-600',
    primaryRing: 'focus:ring-brand-500/20',
    primaryBgSubtle: 'bg-success-bg',
    surfaceBackground: 'bg-surface-raised',
    inputBackground: 'bg-surface-raised',
    borderColor: 'border-input-border',
    borderTransparent: 'border-transparent',
    textColor: 'text-ink',
    textMuted: 'text-muted',
    textMutedDark: 'text-muted-soft',
    textDisabled: 'text-muted-soft/55',
    textDay: 'text-ink-soft',
    textBackground: 'text-navy-950',
    hoverBackground: 'hover:bg-surface-hover',
    hoverText: 'hover:text-brand-text',
    hoverTextMuted: 'hover:text-muted',
} satisfies CalendarCustomDesign
