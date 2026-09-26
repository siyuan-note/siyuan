type HeadingInfo = {headingChildren?: boolean};
type RequestHeadingInfo = (ids: string[], notebook: string,
                           done: (info: Record<string, HeadingInfo | null> | null) => void) => void;

const refreshers = new WeakMap<IProtyle, () => void>();

export const refreshHeadingFoldIndicators = (protyle: IProtyle) => {
    refreshers.get(protyle)?.();
};

// 只查询折叠标题，使用内核完整树的结果，避免将分页和折叠省略的内容误判为空。
export const bindHeadingFoldIndicators = (protyle: IProtyle, root: HTMLElement, request: RequestHeadingInfo) => {
    let timer: number;
    let version = 0;
    let disposed = false;
    const refresh = () => {
        const currentVersion = ++version;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            if (disposed || !root.isConnected) {
                return;
            }
            const rootID = protyle.block.rootID;
            const notebook = protyle.notebookId;
            const headings = Array.from(root.querySelectorAll('[data-type="NodeHeading"][fold="1"]'));
            const ids = Array.from(new Set(headings.map(heading => heading.getAttribute("data-node-id")).filter(Boolean)));
            if (ids.length === 0) {
                return;
            }
            request(ids, notebook, info => {
                if (!info || disposed || version !== currentVersion || !root.isConnected ||
                    protyle.block.rootID !== rootID || protyle.notebookId !== notebook) {
                    return;
                }
                headings.forEach(heading => {
                    if (!root.contains(heading) || heading.getAttribute("fold") !== "1") {
                        return;
                    }
                    if (info[heading.getAttribute("data-node-id")]?.headingChildren === false) {
                        heading.setAttribute("data-heading-empty", "true");
                    } else {
                        heading.removeAttribute("data-heading-empty");
                    }
                });
            });
        }, 150);
    };
    const observer = new MutationObserver(records => {
        // 行内输入和标记自身的更新不会重新查询；块结构及折叠状态变化合并刷新。
        if (records.some(record => record.type === "attributes" ||
            [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node => {
                return node instanceof Element &&
                    (node.hasAttribute("data-node-id") || node.querySelector("[data-node-id]"));
            }))) {
            refresh();
        }
    });
    observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["fold", "data-subtype", "data-node-id"],
    });
    refreshers.set(protyle, refresh);
    refresh();
    return () => {
        disposed = true;
        version++;
        window.clearTimeout(timer);
        observer.disconnect();
        refreshers.delete(protyle);
    };
};
