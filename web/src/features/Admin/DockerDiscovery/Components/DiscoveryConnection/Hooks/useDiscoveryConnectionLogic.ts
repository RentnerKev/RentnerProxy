import { useForm, useStore } from '@tanstack/react-form'
import { useId, useRef, useState, type FormEvent } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import { dockerEndpointSchema } from '@/lib/DockerDiscovery/validation.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    DiscoveryConnectionProps,
    DiscoveryConnectionLogicResult,
} from '../../../Types/discovery-ui.types.ts'

export default function useDiscoveryConnectionLogic(props: DiscoveryConnectionProps) {
    const { t } = useTranslationStore()
    const formId = useId()
    const testing = useRef(false)
    const [isTesting, setIsTesting] = useState(false)
    const [testedEndpoint, setTestedEndpoint] = useState<string | null>(null)
    const form = useForm({
        defaultValues: { endpoint: props.context.endpoint, acknowledgeRestore: false },
        onSubmit: async ({ value }) => {
            const endpoint = value.endpoint.trim()
            if (props.pending || testing.current) return
            if (!dockerEndpointSchema.safeParse(endpoint).success) {
                toast.error(t('admin.dockerDiscovery.errors.invalid_input'), {
                    title: t('toast.titles.error'),
                })
                return
            }
            if (
                testedEndpoint !== endpoint ||
                (props.context.restorePaused && !value.acknowledgeRestore)
            ) {
                toast.info(t('admin.dockerDiscovery.messages.testRequired'), {
                    title: t('toast.titles.info'),
                })
                return
            }
            await props.onSave({
                ...value,
                endpoint,
                connectorRevision: props.context.connectorRevision,
            })
        },
    })
    const values = useStore(form.store, (state) => state.values)
    async function test() {
        if (testing.current || props.pending) return
        const endpoint = values.endpoint.trim()
        if (!dockerEndpointSchema.safeParse(endpoint).success) {
            toast.error(t('admin.dockerDiscovery.errors.invalid_input'), {
                title: t('toast.titles.error'),
            })
            return
        }
        testing.current = true
        setIsTesting(true)
        setTestedEndpoint(null)
        try {
            const result = await props.api.inspect({ endpoint })
            setTestedEndpoint(endpoint)
            toast.success(
                t('admin.dockerDiscovery.messages.tested', { count: result.candidates.length }),
                { title: t('toast.titles.success') },
            )
        } catch (error) {
            const key = error instanceof Error ? error.message : ''
            toast.error(
                t(
                    /^(admin\.dockerDiscovery\.errors\.[a-zA-Z_]+|errors\.[a-zA-Z_]+)$/u.test(key)
                        ? key
                        : 'admin.dockerDiscovery.errors.requestFailed',
                ),
                { title: t('toast.titles.error') },
            )
        } finally {
            testing.current = false
            setIsTesting(false)
        }
    }
    return {
        form,
        state: {
            formId,
            pending: props.pending || isTesting,
            testing: isTesting,
            canSave:
                testedEndpoint === values.endpoint.trim() &&
                (!props.context.restorePaused || values.acknowledgeRestore),
        },
        handler: {
            test,
            close: () => {
                if (!props.pending && !testing.current) props.onClose()
            },
            disconnect: () => {
                if (!props.pending && !testing.current) void props.onDisconnect()
            },
            submit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                void form.handleSubmit()
            },
        },
    } satisfies DiscoveryConnectionLogicResult<typeof form>
}
