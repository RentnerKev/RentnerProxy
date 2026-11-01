import { CheckboxInput, PasswordInput, TextInput } from '@rentnerkev/inputs'

import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import useOffHostBackupLogic from '../Hooks/useOffHostBackupLogic.ts'

import type { OffHostBackupProps } from '../Types/backups-ui.types.ts'

export default function OffHostBackup(props: OffHostBackupProps) {
    const { t, locale } = useTranslationStore()

    const { state, handler } = useOffHostBackupLogic(props)

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-6 shadow-surface"
            aria-labelledby={state.id + '-title'}
        >
            <h2 id={state.id + '-title'} className="text-lg font-extrabold text-ink">
                {t('admin.backups.offHost.title')}
            </h2>

            <p className="mt-2 text-sm text-ink-soft">{t('admin.backups.offHost.description')}</p>

            <p className="mt-2 text-sm text-ink-soft">
                {t(
                    props.configuration.configured
                        ? 'admin.backups.offHost.configured'
                        : 'admin.backups.offHost.unconfigured',
                )}{' '}
                · {t('admin.backups.offHost.copies', { count: props.configuration.retainedCopies })}
            </p>

            {props.configuration.keyId ? (
                <p className="mt-2 break-all font-mono text-xs text-muted">
                    {t('admin.backups.offHost.keyId')}: {props.configuration.keyId}
                </p>
            ) : null}

            <form onSubmit={handler.handleSubmit} className="mt-5 grid gap-5" noValidate>
                <label className="flex items-center gap-3 text-sm font-bold text-ink">
                    <CheckboxInput
                        name="offHostEnabled"
                        checked={state.enabled}
                        disabled={state.locked}
                        onChange={(event) => handler.handleEnabledChange(event.target.checked)}
                    />
                    {t('admin.backups.offHost.enabled')}
                </label>

                <div className="grid gap-5 sm:grid-cols-2">
                    {(['endpoint', 'region', 'bucket', 'prefix'] as const).map((name) => (
                        <TextInput
                            key={name}
                            name={name}
                            label={t(`admin.backups.offHost.${name}`)}
                            value={state[name]}
                            onValueChange={(value) => handler.handleTextChange(name, value)}
                            disabled={state.locked}
                            locale={locale}
                            validationMode="external"
                            maxLength={
                                name === 'endpoint'
                                    ? 512
                                    : name === 'prefix'
                                      ? 256
                                      : name === 'region'
                                        ? 64
                                        : 63
                            }
                        />
                    ))}

                    {(['accessKeyId', 'secretAccessKey'] as const).map((name) => (
                        <PasswordInput
                            key={name}
                            name={name}
                            label={t(`admin.backups.offHost.${name}`)}
                            value={state[name]}
                            onValueChange={(value) => handler.handleTextChange(name, value)}
                            disabled={state.locked}
                            locale={locale}
                            autoComplete="new-password"
                            validationMode="external"
                            maxLength={name === 'accessKeyId' ? 256 : 512}
                        />
                    ))}
                </div>

                <p className="text-sm text-ink-soft">{t('admin.backups.offHost.secretsHelp')}</p>

                <p className="text-sm text-ink-soft">{t('admin.backups.offHost.keyHelp')}</p>

                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.locked}
                        onClick={handler.handleGenerate}
                    >
                        {t('admin.backups.offHost.generate')}
                    </button>

                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.locked || !state.recoveryKey}
                        onClick={handler.handleDownload}
                    >
                        {t('admin.backups.offHost.download')}
                    </button>
                </div>

                {state.recoveryKey ? (
                    <div className="grid gap-3">
                        <output aria-live="polite" className="text-sm font-bold text-ink">
                            {t('admin.backups.offHost.keyGenerated')}
                        </output>
                        <PasswordInput
                            key={state.recoveryKeyGeneration}
                            id={state.id + '-recovery-key'}
                            name="recoveryKey"
                            label={t('admin.backups.offHost.newRecoveryKey')}
                            value={state.recoveryKey}
                            onValueChange={() => undefined}
                            readOnly
                            disabled={state.locked}
                            locale={locale}
                            autoComplete="off"
                            validationMode="external"
                        />
                    </div>
                ) : null}

                {state.recoveryKey ? (
                    <label className="flex items-center gap-3 text-sm font-bold text-ink">
                        <CheckboxInput
                            name="recoveryKeySaved"
                            checked={state.recoveryKeySaved}
                            disabled={state.locked || !state.downloaded}
                            onChange={(event) => handler.handleSavedChange(event.target.checked)}
                        />
                        {t('admin.backups.offHost.saved')}
                    </label>
                ) : null}

                {state.conflict ? (
                    <p role="alert" className="text-sm text-warning-text">
                        {t('admin.backups.schedule.conflict')}
                    </p>
                ) : null}

                <div className="flex flex-wrap gap-3">
                    <button
                        type="submit"
                        className={buttonClassName('primary')}
                        disabled={!state.canSave}
                    >
                        {t('admin.backups.offHost.save')}
                    </button>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.locked}
                        onClick={handler.handleReset}
                    >
                        {t('admin.backups.schedule.reset')}
                    </button>
                </div>
            </form>

            <details className="mt-5 text-sm text-ink-soft">
                <summary className="cursor-pointer font-bold">
                    {t('admin.backups.offHost.recoveryTitle')}
                </summary>
                <p className="mt-3">{t('admin.backups.offHost.recoveryHelp')}</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-canvas p-3">
                    {state.recoveryCommand}
                </pre>
                <p className="mt-3">{t('admin.backups.offHost.restoreHelp')}</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-canvas p-3">
                    {state.restoreCommand}
                </pre>
            </details>
        </section>
    )
}
