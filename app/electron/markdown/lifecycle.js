const createMarkdownLifecycle = ({getManager, quit, log = () => {}}) => {
    let quitting;
    const hasPendingWork = manager => !!(manager?.hasPendingWork?.() ?? manager?.hasWindows());
    const call = async (method, ...args) => {
        const manager = getManager();
        if (!hasPendingWork(manager)) return true;
        try {
            return await manager[method](...args);
        } catch (error) {
            log("Markdown " + method + " failed: " + error.message);
            return false;
        }
    };
    return {
        busy: () => !!quitting,
        hasWindows: () => !!getManager()?.hasWindows(),
        prepare: reason => call("prepareQuit", reason),
        finish: () => call("closeAll"),
        cancel: () => getManager()?.cancelQuit(),
        beforeQuit(event) {
            if (!hasPendingWork(getManager())) return false;
            event.preventDefault();
            if (!quitting) {
                // 先完成所有轻量窗口的退出保护，再交给现有工作空间退出流程。
                quitting = call("closeAll").then(closed => {
                    quitting = undefined;
                    if (closed) quit();
                });
            }
            return true;
        },
    };
};

module.exports = {createMarkdownLifecycle};
