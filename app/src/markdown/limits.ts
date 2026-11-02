// 文件预算与各平台宿主一致；富文本和预览使用独立的较小预算。
export const MARKDOWN_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MARKDOWN_RENDER_BYTES = 64 * 1024;
export const MARKDOWN_RECOVERY_BYTES = 16 * 1024 * 1024;
export const markdownByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
