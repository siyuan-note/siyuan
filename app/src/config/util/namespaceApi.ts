import {config} from "./configApi";
import {createSectionRuntime, type Reaction} from "./sectionRuntime";

export function createConfigNamespaceApi<TData>(options: {
    namespace: string;
    getConfig: () => TData;
    setConfig: (data: TData) => void | Promise<void>;
    reactions?: Reaction<TData>[];
}): {
    /** onApplied 在已确认配置与运行时动作应用完成后执行 */
    patch: (relOrFullId: string, value: unknown, onApplied?: (data: TData) => void) => Promise<void>;
    apply: (data: TData) => void | Promise<void>;
} {
    const {namespace} = options;
    const runtime = createSectionRuntime({namespace, get: options.getConfig, set: options.setConfig,
        reactions: options.reactions || []});

    return {
        patch: (path, value, onApplied) => config.set(path.startsWith(`${namespace}.`) ? path : `${namespace}.${path}`,
            value, data => onApplied?.(data as TData)),
        apply: runtime.apply,
    };
}
