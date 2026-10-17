import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import { version } from 'country-flag-icons/package.json'
import CountryFlag from '@/shared/Geography/CountryFlag.tsx'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

function renderFlag(code: string | null | undefined) {
    return renderToStaticMarkup(
        withTestLanguage(
            <TooltipProvider>
                <CountryFlag code={code} />
            </TooltipProvider>,
            'de',
        ),
    )
}

describe('country flag delivery', () => {
    test('renders a local versioned image with a localized accessible name and stable dimensions', () => {
        const markup = renderFlag('DE')
        expect(markup).toContain(`src="/assets/country-flags/${version}/DE.svg"`)
        expect(markup).toContain('alt="Deutschland"')
        expect(markup).toContain('width="24"')
        expect(markup).toContain('height="16"')
        expect(markup).toContain('loading="lazy"')
        expect(markup).not.toContain('data:image')
    })

    test('keeps a language-card flag decorative without an extra tooltip or accessible name', () => {
        const markup = renderToStaticMarkup(
            withTestLanguage(<CountryFlag code="GB" decorative className="h-6 w-9" />),
        )
        expect(markup).toContain('/GB.svg')
        expect(markup).toContain('alt=""')
        expect(markup).toContain('aria-hidden="true"')
        expect(markup).toContain('class="h-6 w-9"')
        expect(markup).not.toContain('data-state')
    })

    test.each([null, undefined, '', 'de', 'ZZ', 'GB-ENG', '../DE', 'DE.svg', '<script>'])(
        'does not request a flag for an unsupported or invalid country code: %j',
        (code) => expect(renderFlag(code)).toBe(''),
    )
})
