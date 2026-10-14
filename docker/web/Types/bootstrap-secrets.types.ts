export interface BootstrapSecretState {
    appEncryptionKey: string
    controllerToken: string
    databaseUrl: string
    postgresPassword: string
    version: 1
}

export type BootstrapSecretName = Exclude<keyof BootstrapSecretState, 'version'>

export interface PendingAppKeyRestore {
    nextAppEncryptionKey: string
    previousAppEncryptionKey: string
    version: 1
}

export interface ProductionRestoreJournal {
    backupId: string
    version: 1
}
