const multilineInputTypes = new Set([
    "insertText",
    "insertReplacementText",
    "insertCompositionText",
]);

export const getMultilineInputText = (inputType: string, data: string | null) => {
    if (!data || !multilineInputTypes.has(inputType) || !/[\r\n\u2028\u2029]/.test(data)) {
        return;
    }
    return data.replace(/\r\n|\r|\u2028|\u2029/g, "\n");
};
