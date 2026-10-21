import { CustomSelect } from '@rentnerkev/select/select'
import { HOST_TAG_LIMITS } from '@/config/host-tags.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useHostTagSelectLogic from '../Hooks/useHostTagSelectLogic.ts'
import HostTagBadge from './HostTagBadge.tsx'
import type { HostTagSelectProps } from '../Types/host-tags-ui.types.ts'

export default function HostTagSelect(props: HostTagSelectProps) {
    const { state, handler } = useHostTagSelectLogic(props.kind)
    const { t } = useTranslationStore()
    return (
        <div className="min-w-0 shell:col-span-2">
            <CustomSelect
                id={state.id}
                label={t('admin.hostTags.title')}
                multiple
                searchable
                textOverflow="wrap"
                value={[...props.value]}
                options={state.options}
                renderOption={(option) => (
                    <HostTagBadge
                        tag={
                            state.tagsById.get(option.value) ?? {
                                id: option.value,
                                name: option.label,
                            }
                        }
                    />
                )}
                renderValue={(options) => (
                    <span className="flex min-w-0 flex-wrap gap-1.5">
                        {options.map((option) => (
                            <HostTagBadge
                                key={option.value}
                                tag={
                                    state.tagsById.get(option.value) ?? {
                                        id: option.value,
                                        name: option.label,
                                    }
                                }
                            />
                        ))}
                    </span>
                )}
                onValueChange={props.onChange}
                disabled={props.disabled || state.loading || state.error}
                maxSelection={HOST_TAG_LIMITS.tagsPerHost}
                placeholder={t('admin.hostTags.select')}
                messages={{
                    searchPlaceholder: t('admin.hostTags.search'),
                    noResults: t('table.noResults'),
                }}
            />
            {state.error ? (
                <div
                    role="alert"
                    className="mt-2 flex flex-wrap items-center gap-2 text-sm text-danger-text"
                >
                    {t('admin.hostTags.errors.loadFailed')}
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        onClick={handler.retry}
                    >
                        {t('common.retry')}
                    </button>
                </div>
            ) : null}
        </div>
    )
}
