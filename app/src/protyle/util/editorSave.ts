interface EditorSaveRecord {
    pending: Set<Promise<void>>;
    results: Map<string, {version: number, failed: boolean}>;
    version: number;
    failedStructure: boolean;
    disposed: boolean;
}

const editors = new Map<IProtyle, EditorSaveRecord>();

// 仅由需要确认保存结果后才能销毁的编辑器启用，不改变普通请求的错误处理。
export const registerEditorSave = (protyle: IProtyle) => {
    const record: EditorSaveRecord = {
        pending: new Set(), results: new Map(), version: 0, failedStructure: false, disposed: false,
    };
    editors.set(protyle, record);
    return {
        flush: async () => {
            while (!record.disposed && record.pending.size) {
                await Promise.all([...record.pending]);
            }
            if (!record.disposed && (record.failedStructure || [...record.results.values()].some(result => result.failed))) {
                throw new Error(window.siyuan.languages.settingsPendingSaveError);
            }
        },
        dispose: () => {
            record.disposed = true;
            record.pending.clear();
            record.results.clear();
            record.failedStructure = false;
            if (editors.get(protyle) === record) {
                editors.delete(protyle);
            }
        },
    };
};

export const trackEditorSaveRequest = <T>(url: string, data: any, promise: Promise<T>): Promise<T> => {
    if (!editors.size || (url !== "/api/transactions" && url !== "/api/filetree/renameDoc")) {
        return promise;
    }
    const transactions = url === "/api/transactions";
    // 只保存目标 ID 和结果，不保留块 HTML、标题或可重放的请求数据。
    const transactionList = transactions && Array.isArray(data?.transactions) ? data.transactions : [];
    const operations = transactionList.flatMap((item: {doOperations?: IOperation[]}) =>
        Array.isArray(item?.doOperations) ? item.doOperations : []);
    const keys: string[] = transactions ? operations.length && operations.every((item: IOperation) =>
        item?.action === "update" && item.id && typeof item.data === "string") ?
        [...new Set<string>(operations.map((item: IOperation) => `block:${item.id}`))] : [] : ["title"];
    const transactionCount = transactionList.length;
    editors.forEach((record, protyle) => {
        if (transactions ? data?.session !== protyle.id :
            !protyle.path || !protyle.notebookId || data?.path !== protyle.path || data?.notebook !== protyle.notebookId) {
            return;
        }
        const version = ++record.version;
        const complete = (failed: boolean) => {
            if (record.disposed) {
                return;
            }
            if (!keys.length) {
                // 结构操作的结果不明确时禁止自动重放，也不能用之后的文本保存覆盖其失败状态。
                record.failedStructure ||= failed;
            } else {
                keys.forEach(key => {
                    if ((record.results.get(key)?.version || 0) < version) {
                        record.results.set(key, {version, failed});
                    }
                });
            }
        };
        const pending = promise.then((response: any) => {
            complete(response?.code !== 0 || (transactions && (!transactionCount ||
                !Array.isArray(response.data) || response.data.length !== transactionCount ||
                response.data.some((item: {doOperations?: IOperation[]}) => !Array.isArray(item?.doOperations)))));
        }, () => complete(true));
        record.pending.add(pending);
        void pending.then(() => record.pending.delete(pending));
    });
    return promise;
};
