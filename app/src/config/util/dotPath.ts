/** 按实心点路径读取（与控件 `id` 点分约定一致） */
export function getAtPath(root: unknown, dottedPath: string): unknown {
    const segments = dottedPath.split(".");
    let cur: unknown = root;
    for (const s of segments) {
        if (cur === null || cur === undefined) {
            return undefined;
        }
        cur = (cur as Record<string, unknown>)[s];
    }
    return cur;
}

/**
 * 按点分路径将叶子值合并进配置对象（浅拷贝根后不可变下钻）。
 * 供各设置 Tab 按控件 id 合并单项；具体读 DOM 仍由各面板实现。
 */
function assignPathImmutable(
    obj: Record<string, unknown>,
    segments: string[],
    value: unknown
): Record<string, unknown> {
    if (segments.length === 1) {
        return {...obj, [segments[0]]: value};
    }
    const [head, ...rest] = segments;
    const child = obj[head];
    const base =
        typeof child === "object" && child !== null && !Array.isArray(child)
            ? {...(child as Record<string, unknown>)}
            : {};
    return {
        ...obj,
        [head]: assignPathImmutable(base, rest, value),
    };
}

/** 将叶子值合并到任意以字符串为键的配置对象（先浅拷贝根再按路径写入） */
export function mergeRecordByDottedPath<T extends Record<string, unknown>>(
    base: T,
    dottedId: string,
    value: unknown
): T {
    const segments = dottedId.split(".");
    return assignPathImmutable({...(base as unknown as Record<string, unknown>)}, segments, value) as T;
}
