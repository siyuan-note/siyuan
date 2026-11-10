export const isBazaarBatchUpdateExcluded = (
    excluded: Partial<Record<TBazaarType, Record<string, boolean>>> | undefined,
    type: TBazaarType,
    name: string,
) => excluded?.[type]?.[name] === true;
