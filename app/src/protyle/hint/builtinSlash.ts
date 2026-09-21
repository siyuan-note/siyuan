type TSlashHint = (key: string, protyle: IProtyle, source: THintSource) => IHintData[];

type TBuiltinSlashValue = (value: string, protyle: IProtyle) => boolean;

const builtinSlashHints = new WeakMap<TSlashHint, TBuiltinSlashValue>();

// 标记内置斜杠菜单及其过滤包装，保留候选项的命令语义。
export const registerBuiltinSlashHint = <T extends TSlashHint>(hint: T,
                                                            isBuiltinValue: TBuiltinSlashValue = () => true): T => {
    builtinSlashHints.set(hint, isBuiltinValue);
    return hint;
};

export const isBuiltinSlashHint = (hint: TSlashHint, value: string, protyle: IProtyle) =>
    builtinSlashHints.get(hint)?.(value, protyle) ?? false;
