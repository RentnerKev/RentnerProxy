import type { ManagedBackupJob } from '@/lib/Backups/Types/backups.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function BackupStateBadge({ state }: { readonly state: ManagedBackupJob['state'] }) {
    const { t } = useTranslationStore()
    return (
        <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold ${
                state === 'succeeded'
                    ? 'bg-success-soft text-success-text'
                    : state === 'failed' || state === 'interrupted'
                      ? 'bg-danger-soft text-danger-text'
                      : 'bg-accent-soft text-accent'
            }`}
        >
            {t(`admin.backups.states.${state}`)}
        </span>
    )
}
