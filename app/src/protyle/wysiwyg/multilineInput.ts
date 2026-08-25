const textInputTypes = new Set([
    "insertText",
    "insertReplacementText",
    "insertCompositionText",
]);

export const isTextInputType = (inputType: string, data: string | null): data is string => {
    return !!data && textInputTypes.has(inputType);
};

export const getMultilineInputText = (inputType: string, data: string | null) => {
    if (!isTextInputType(inputType, data) || !/[\r\n\u2028\u2029]/.test(data)) {
        return;
    }
    return data.replace(/\r\n|\r|\u2028|\u2029/g, "\n");
};
