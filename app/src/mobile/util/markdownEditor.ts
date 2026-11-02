interface MobileMarkdownEntry {
    JSAndroid?: {openMarkdownEditor?(): void};
    JSHarmony?: {openMarkdownEditor?(): void};
    webkit?: {messageHandlers?: {openMarkdownEditor?: {postMessage(message: string): void}}};
}

// 只请求宿主打开独立容器；外部文件权限由该容器的系统选择器取得。
export const getMobileMarkdownOpener = (host: MobileMarkdownEntry = window): (() => void) | undefined => {
    if (typeof host.JSAndroid?.openMarkdownEditor === "function") return () => host.JSAndroid.openMarkdownEditor();
    if (typeof host.JSHarmony?.openMarkdownEditor === "function") return () => host.JSHarmony.openMarkdownEditor();
    if (host.webkit?.messageHandlers?.openMarkdownEditor) return () => host.webkit.messageHandlers.openMarkdownEditor.postMessage("");
};
