import type {MarkdownWindows} from "./windows";

const createMarkdownLifecycle = ({getManager, quit, log = () => {}}: {
    getManager: () => MarkdownWindows | undefined;
    quit: () => void;
    log?: (message: string) => void;
}) => {
    let quitting: Promise<void> | undefined;
    const hasPendingWork = (manager: MarkdownWindows | undefined): boolean =>
        !!(manager?.hasPendingWork?.() ?? manager?.hasWindows());
    const call = async (method: "prepareQuit" | "closeAll", reason?: string): Promise<boolean> => {
        const manager = getManager();
        if (!manager || !hasPendingWork(manager)) return true;
        try {
            return method === "prepareQuit" ? await manager.prepareQuit(reason) : await manager.closeAll();
        } catch (error) {
            log("Markdown " + method + " failed: " + (error instanceof Error ? error.message : String(error)));
            return false;
        }
    };
    return {
        busy: () => !!quitting,
        hasWindows: () => !!getManager()?.hasWindows(),
        hasPendingWork: () => hasPendingWork(getManager()),
        prepare: (reason: string) => call("prepareQuit", reason),
        finish: () => call("closeAll"),
        cancel: () => getManager()?.cancelQuit(),
        beforeQuit(event: {preventDefault: () => void}) {
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

export {createMarkdownLifecycle};
export type MarkdownLifecycle = ReturnType<typeof createMarkdownLifecycle>;
