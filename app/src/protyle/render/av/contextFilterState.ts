export const getContextFilterKeyID = (contextFilter?: IAVContextFilter | null) => {
    return contextFilter?.spec === 1 && typeof contextFilter.keyID === "string" ? contextFilter.keyID : "";
};

export const getContextFilterFields = (fields?: IAVContextFilterField[]) => {
    return (fields || []).filter((field) => !!field.id && !!field.targetAvID);
};

export const createContextFilter = (keyID: string): IAVContextFilter | null => {
    return keyID ? {spec: 1, keyID} : null;
};
