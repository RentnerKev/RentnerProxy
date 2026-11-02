import { useStore } from '@tanstack/react-form'
import { useState } from 'react'
import { MAX_PROXY_UPSTREAM_MEMBERS } from '@/config/upstream-pools.config.ts'
import type {
    UpstreamPoolFieldsLogicResult,
    UpstreamPoolFieldsProps,
    UpstreamPoolFormMember,
} from '../Types/upstream-pool-fields.types.ts'

export default function useUpstreamPoolFieldsLogic({
    form,
}: Pick<UpstreamPoolFieldsProps, 'form'>): UpstreamPoolFieldsLogicResult {
    const pool = useStore(form.store, (state) => state.values.upstreamPool)
    const [memberKeys, setMemberKeys] = useState(() =>
        (form.getFieldValue('upstreamPool')?.members ?? []).map(() => crypto.randomUUID()),
    )
    const revalidate = () => {
        if (form.state.submissionAttempts > 0) void form.validate('submit')
    }
    const updateMembers = (members: UpstreamPoolFormMember[]) => {
        const current = form.getFieldValue('upstreamPool')
        if (!current || !members[0]) return
        form.setFieldValue('upstreamPool', { ...current, members })
        form.setFieldValue('forwardHost', members[0].host)
        form.setFieldValue('forwardPort', members[0].port)
        revalidate()
    }
    return {
        state: {
            pool,
            memberKeys,
            canAdd: Boolean(pool && pool.members.length < MAX_PROXY_UPSTREAM_MEMBERS),
        },
        handler: {
            handleModeChange: (value) => {
                if (value === 'single') {
                    form.setFieldValue('upstreamPool', null)
                    setMemberKeys([])
                    revalidate()
                    return
                }
                if (value !== 'round_robin' && value !== 'first') return
                const current = form.getFieldValue('upstreamPool')
                form.setFieldValue('upstreamPool', {
                    ...current,
                    policy: value,
                    members: current?.members ?? [
                        {
                            host: form.getFieldValue('forwardHost'),
                            port: form.getFieldValue('forwardPort'),
                        },
                    ],
                })
                if (!current) setMemberKeys([crypto.randomUUID()])
                revalidate()
            },
            handlePrimaryHostChange: (value) => {
                form.setFieldValue('forwardHost', value)
                const current = form.getFieldValue('upstreamPool')
                if (current)
                    form.setFieldValue('upstreamPool', {
                        ...current,
                        members: current.members.map((member, index) =>
                            index === 0 ? { host: value, port: member.port } : member,
                        ),
                    })
                revalidate()
            },
            handlePrimaryPortChange: (value) => {
                form.setFieldValue('forwardPort', value)
                const current = form.getFieldValue('upstreamPool')
                if (current)
                    form.setFieldValue('upstreamPool', {
                        ...current,
                        members: current.members.map((member, index) =>
                            index === 0 ? { host: member.host, port: value } : member,
                        ),
                    })
                revalidate()
            },
            handleMemberHostChange: (index, value) => {
                const current = form.getFieldValue('upstreamPool')
                if (current)
                    updateMembers(
                        current.members.map((member, memberIndex) =>
                            memberIndex === index ? { host: value, port: member.port } : member,
                        ),
                    )
            },
            handleMemberPortChange: (index, value) => {
                const current = form.getFieldValue('upstreamPool')
                if (current)
                    updateMembers(
                        current.members.map((member, memberIndex) =>
                            memberIndex === index ? { host: member.host, port: value } : member,
                        ),
                    )
            },
            handleAdd: () => {
                const current = form.getFieldValue('upstreamPool')
                if (!current || current.members.length >= MAX_PROXY_UPSTREAM_MEMBERS) return
                updateMembers([
                    ...current.members,
                    { host: '', port: form.getFieldValue('forwardPort') },
                ])
                setMemberKeys((keys) => [...keys, crypto.randomUUID()])
            },
            handleRemove: (index) => {
                const current = form.getFieldValue('upstreamPool')
                if (
                    !current ||
                    index < 0 ||
                    index >= current.members.length ||
                    current.members.length <= 1
                )
                    return
                updateMembers(current.members.filter((_, memberIndex) => memberIndex !== index))
                setMemberKeys((keys) => keys.filter((_, memberIndex) => memberIndex !== index))
            },
            handleMove: (index, direction) => {
                const current = form.getFieldValue('upstreamPool')
                const destination = index + direction
                if (
                    !current ||
                    index < 0 ||
                    index >= current.members.length ||
                    destination < 0 ||
                    destination >= current.members.length
                )
                    return
                const members = [...current.members]
                ;[members[index], members[destination]] = [members[destination]!, members[index]!]
                updateMembers(members)
                setMemberKeys((keys) => {
                    const reordered = [...keys]
                    ;[reordered[index], reordered[destination]] = [
                        reordered[destination]!,
                        reordered[index]!,
                    ]
                    return reordered
                })
            },
        },
    }
}
