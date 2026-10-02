const pending = new Set<Promise<unknown>>();
let failures = 0;

export const settingSaveFailures = () => failures;

// 同时跟踪排队保存和在途请求，重置前等待其完成。
export const trackSettingSave = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    void promise.then((result) => {
        pending.delete(promise);
        if (result && typeof result === "object" && "code" in result && result.code !== 0) failures++;
    }, () => {
        pending.delete(promise);
        failures++;
    });
    return promise;
};

export const trackSettingRequest = <T>(url: string, promise: Promise<T>): Promise<T> =>
    /^\/api\/(setting\/(set|patch)|storage\/(set|remove)LocalStorage|system\/set|graph\/(setGraphConf|resetGraph|resetLocalGraph|getGraph|getLocalGraph)$)/.test(url)
        ? trackSettingSave(promise) : promise;

export const flushSettingSaves = async (previousFailures = failures) => {
    while (pending.size) {
        await Promise.all([...pending]);
    }
    if (failures !== previousFailures) throw new Error("Could not save pending settings");
};
