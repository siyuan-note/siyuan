export const shouldSubmitDateEdit = (dirty: boolean, requireExplicitChange: boolean) => {
    return dirty || !requireExplicitChange;
};
