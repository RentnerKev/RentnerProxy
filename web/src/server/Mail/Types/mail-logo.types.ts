export type MailLogoAttachment = Readonly<{
    filename: string
    cid: string
    content: Buffer
    contentType: 'image/png'
    contentDisposition: 'inline'
}>
