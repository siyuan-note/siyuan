type TSlashHint = (key: string, protyle: IProtyle, source: THintSource) => IHintData[];

const builtinSlashHints = new WeakSet<TSlashHint>();

// 标记内置斜杠菜单及其过滤包装，保留候选项的命令语义。
export const registerBuiltinSlashHint = <T extends TSlashHint>(hint: T): T => {
    builtinSlashHints.add(hint);
    return hint;
};

export const isBuiltinSlashHint = (hint: TSlashHint) => builtinSlashHints.has(hint);
