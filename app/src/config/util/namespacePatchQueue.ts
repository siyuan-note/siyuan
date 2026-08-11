import {mergeRecordByDottedPath} from "./dotPath";

export const createNamespacePatchQueue = <TData>(options: {
    namespace: string;
    getConfig: () => TData;
    submit: (payload: TData) => Promise<TData | undefined>;
}) => {
    const prefix = `${options.namespace}.`;
    let queue = Promise.resolve();

    return (relOrFullId: string, value: unknown, onApplied?: (data: TData) => void) => {
        const rel = relOrFullId.startsWith(prefix) ? relOrFullId.slice(prefix.length) : relOrFullId;
        if (!rel) {
            return;
        }
        queue = queue.then(async () => {
            const prev = options.getConfig() as unknown as Record<string, unknown>;
            const payload = mergeRecordByDottedPath(prev, rel, value) as unknown as TData;
            const data = await options.submit(payload);
            if (data !== undefined) {
                onApplied?.(data);
            }
        }).catch((error) => {
            console.warn("config patch failed", error);
        });
    };
};
