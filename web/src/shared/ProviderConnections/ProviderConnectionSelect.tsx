import { CustomSelect } from '@rentnerkev/select/select'
import useProviderConnectionSelectLogic from './Hooks/useProviderConnectionSelectLogic.ts'
import ProviderConnectionStatus from './ProviderConnectionStatus.tsx'
import type { ProviderConnectionSelectProps } from './Types/provider-connections.types.ts'

export default function ProviderConnectionSelect(props: ProviderConnectionSelectProps) {
    const { state } = useProviderConnectionSelectLogic(props)
    return (
        <div className="grid min-w-0 gap-2">
            <CustomSelect
                {...(props.id ? { id: props.id } : {})}
                value={props.value || null}
                options={state.options}
                onValueChange={props.onValueChange}
                disabled={props.disabled ?? false}
                label={state.label}
                aria-label={state.label}
                aria-invalid={props.invalid}
                placeholder={state.placeholder}
                fallbackOption={state.unavailable}
                locale={state.locale}
                renderOption={(option) => (
                    <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <span className="break-words">{option.label}</span>
                        {state.connectionsById.get(option.value) ? (
                            <ProviderConnectionStatus
                                connection={state.connectionsById.get(option.value)!}
                            />
                        ) : null}
                    </span>
                )}
                renderValue={(options) =>
                    options.map((option) => (
                        <span
                            key={option.value}
                            className="flex min-w-0 flex-wrap items-center gap-2"
                        >
                            <span className="truncate">{option.label}</span>
                            {state.connectionsById.get(option.value) ? (
                                <ProviderConnectionStatus
                                    connection={state.connectionsById.get(option.value)!}
                                />
                            ) : null}
                        </span>
                    ))
                }
            />
            <a
                href="/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="justify-self-start text-sm font-bold text-accent-ring underline underline-offset-2"
            >
                {state.manageLabel}
            </a>
        </div>
    )
}
