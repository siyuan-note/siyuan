const bindWebviewDevToolsShortcut = (contents, getTarget, platform = process.platform) => {
    if (contents.isDestroyed() || contents.getType() !== "webview") return;
    const onInput = (event, input) => {
        if (input.type !== "keyDown") return;
        const modifiers = platform === "darwin" ? input.meta && input.alt && !input.control && !input.shift :
            input.control && input.shift && !input.meta && !input.alt;
        if (!modifiers || (input.key?.toLowerCase() !== "i" && input.code !== "KeyI")) return;
        try {
            // 每次按键都从 Electron 读取实际宿主，避免挂载前或销毁后的 guest 指向其他窗口。
            if (contents.isDestroyed()) return;
            const host = contents.hostWebContents;
            if (!host || host.isDestroyed() || host.getType() !== "window" || !getTarget(host.id)) return;
            // 主进程同步阻止 guest 和菜单处理同一按键；长按时仍拦截，但只切换一次。
            event.preventDefault();
            if (!input.isAutoRepeat) host.toggleDevTools();
        } catch {
            // guest 或宿主可能已在窗口关闭过程中销毁。
        }
    };
    contents.on("before-input-event", onInput);
    contents.once("destroyed", () => contents.removeListener("before-input-event", onInput));
};

module.exports = {bindWebviewDevToolsShortcut};
