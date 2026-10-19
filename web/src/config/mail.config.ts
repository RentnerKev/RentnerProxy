export const MAIL_LOGO_PATH = '/media/mail-logo/'
// Bump whenever assets, rasterization or encoder updates change the output bytes.
// The public URL and strong ETag both depend on this representation version.
export const MAIL_LOGO_VERSION = '1'
export const MAIL_LOGO_WIDTH = 512
export const MAIL_LOGO_HEIGHT = 192
export const MAIL_LOGO_CACHE_SIZE = 32
export const MAIL_LOGO_MAX_PENDING = 32
export const MAIL_LOGO_RENDER_RATE_LIMITS = {
    client: { scope: 'mail-logo-render-client', limit: 6, windowMs: 60_000 },
    global: { scope: 'mail-logo-render-global', limit: 24, windowMs: 60_000 },
} as const

export const MAIL_BASE_THEMES = {
    light: {
        canvas: '#eef4f0',
        surface: '#fbfdfc',
        raised: '#ffffff',
        border: '#d6e0da',
        ink: '#06120f',
        softInk: '#1d3328',
        muted: '#61756b',
        subtle: '#8a9d93',
        neutral: '#eef2f0',
        successBackground: '#effcf2',
        successText: '#086c27',
        dangerBackground: '#fff3f3',
        dangerText: '#8d1818',
        warningText: '#9a5d12',
    },
    dark: {
        canvas: '#07080a',
        surface: '#0d0f12',
        raised: '#121419',
        border: '#282c33',
        ink: '#f4f5f7',
        softInk: '#d7dae0',
        muted: '#a0a5ae',
        subtle: '#757b85',
        neutral: '#181b21',
        successBackground: '#102419',
        successText: '#76f895',
        dangerBackground: '#331719',
        dangerText: '#ffb0b0',
        warningText: '#ffbd66',
    },
} as const
