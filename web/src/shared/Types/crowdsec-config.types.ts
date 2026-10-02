import { CROWDSEC_MODES } from '@/config/crowdsec.config.ts'
export type CrowdSecMode = (typeof CROWDSEC_MODES)[number]
