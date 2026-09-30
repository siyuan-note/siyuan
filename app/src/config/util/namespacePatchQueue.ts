import {mergeRecordByDottedPath} from "./dotPath";

export const createNamespacePatchQueue = <TData>(options: {
    namespace: string;
    getConfig: () => TData;
    submit: (payload: TData) => Promise<TData | undefined>;
    submitPatch?: (path: string, value: unknown) => Promise<TData | undefined>;
}) => {
    const prefix = `${options.namespace}.`;
    let queue = Promise.resolve();

    return (relOrFullId: string, value: unknown, onApplied?: (data: TData) => void) => {
        const rel = relOrFullId.startsWith(prefix) ? relOrFullId.slice(prefix.length) : relOrFullId;
        if (!rel) {
            return Promise.resolve();
        }
        queue = queue.then(async () => {
            const data = options.submitPatch ? await options.submitPatch(rel, value) : await options.submit(
                mergeRecordByDottedPath(options.getConfig() as unknown as Record<string, unknown>, rel, value) as unknown as TData
            );
            if (data !== undefined) {
                onApplied?.(data);
            }
        }).catch((error) => {
            console.warn("config patch failed", error);
        });
        return queue;
    };
};
