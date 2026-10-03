import type useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export type Translate = ReturnType<typeof useTranslationStore>['t']
