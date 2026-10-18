import { createMailTheme } from './mail-theme.ts'
import { createMailLogoUrl } from './mail-url.ts'
import type { MailLayoutInput } from './Types/mail-theme.types.ts'

export function createMailHtml(input: MailLayoutInput): string {
    const theme = createMailTheme(input.appearance)
    const logoUrl = Bun.escapeHTML(createMailLogoUrl(input.appUrl, theme.accent))
    return `<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="${theme.mode}">
    <meta name="supported-color-schemes" content="${theme.mode}">
    <title>${Bun.escapeHTML(input.heading)}</title>
</head>
<body style="margin:0;background:${theme.canvas};color:${theme.ink};font-family:'Segoe UI Variable','Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${Bun.escapeHTML(input.preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:${theme.canvas};font-family:'Segoe UI Variable','Segoe UI',Arial,sans-serif;">
        <tr>
            <td align="center" style="padding:24px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;">
                    <tr>
                        <td style="padding:0 0 20px;">
                            <img src="${logoUrl}" alt="RentnerProxy" width="320" height="120" style="display:block;width:320px;max-width:100%;height:auto;border:0;">
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:${theme.surface};border:1px solid ${theme.border};border-radius:16px;">
                                <tr>
                                    <td style="padding:24px 24px 0;">
                                        <p style="margin:0 0 12px;color:${theme.accentText};font-family:Consolas,'Liberation Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">${Bun.escapeHTML(input.eyebrow)}</p>
                                        <h1 style="margin:0 0 12px;color:${theme.ink};font-family:'Lilita One','Arial Rounded MT Bold','Trebuchet MS','Segoe UI',sans-serif;font-size:32px;font-weight:800;letter-spacing:-0.035em;line-height:1.1;overflow-wrap:anywhere;">${Bun.escapeHTML(input.heading)}</h1>
                                    </td>
                                </tr>
                                ${input.contentRowsHtml}
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:18px 0 0;color:${theme.muted};font-size:11px;line-height:1.7;">
                            <p style="margin:0;">Automatische Nachricht von RentnerProxy.</p>
                            ${input.footerText ? `<p style="margin:6px 0 0;color:${theme.subtle};font-family:Consolas,'Liberation Mono',monospace;font-size:10px;overflow-wrap:anywhere;word-break:break-word;">${Bun.escapeHTML(input.footerText)}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
}
