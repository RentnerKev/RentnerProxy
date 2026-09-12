import { Moon, Sun } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'

import type { ThemeModeSwitchProps } from './Types/theme-component-props.types'
import getThemeModeSwitchViewModel from './Helpers/getThemeModeSwitchViewModel'

export default function ThemeModeSwitch({ isSaving, onToggle, themeMode }: ThemeModeSwitchProps) {
    const { t } = useTranslationStore()
    const viewModel = getThemeModeSwitchViewModel(themeMode, t)

    return (
        <div className="inline-flex flex-none items-center gap-[0.55rem]">
            <button
                type="button"
                role="switch"
                className="group relative grid h-12 w-24 grid-cols-2 items-center rounded-full border border-border-strong bg-surface-raised p-1 text-muted transition-[border-color,background-color] duration-[180ms] hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-500 disabled:cursor-wait disabled:opacity-[0.68] motion-reduce:transition-none"
                aria-busy={isSaving}
                aria-checked={viewModel.isDark}
                aria-label={t(viewModel.isDark ? 'theme.switchToLight' : 'theme.switchToDark')}
                disabled={isSaving}
                onClick={onToggle}
            >
                <span
                    className={`z-[2] grid place-items-center [&>svg]:size-4 [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] ${viewModel.isDark ? 'text-muted' : 'text-navy-950'}`}
                    aria-hidden="true"
                >
                    <Sun aria-hidden="true" />
                </span>
                <span
                    className={`z-[2] grid place-items-center [&>svg]:size-4 [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] ${viewModel.isDark ? 'text-navy-950' : 'text-muted'}`}
                    aria-hidden="true"
                >
                    <Moon aria-hidden="true" />
                </span>
                <span
                    className="absolute top-1 left-1 z-[1] h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-full bg-brand-500 transition-transform duration-[180ms] group-aria-checked:translate-x-full motion-reduce:transition-none"
                    aria-hidden="true"
                />
            </button>
        </div>
    )
}
