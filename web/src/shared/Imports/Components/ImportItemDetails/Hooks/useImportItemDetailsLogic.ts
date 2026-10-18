import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    ImportItemDetailsProps,
    ImportItemDetailsLogicResult,
} from '../Types/import-item-details.types.ts'

export default function useImportItemDetailsLogic(
    item: ImportItemDetailsProps['item'],
): ImportItemDetailsLogicResult {
    const { t } = useTranslationStore()
    return {
        state: {
            reasons: item.reasons.map((reason) => {
                const [code, detail] = reason.split(':', 2)
                const translated = t(`admin.npmImport.reasons.${code}`)
                return { reason, text: detail ? `${translated} (${detail})` : translated }
            }),
        },
    }
}
