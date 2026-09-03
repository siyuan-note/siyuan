export const syncDocTitleIAL = (ial: Record<string, string>, title: string, empty: boolean, titleEmptyKey: string) => {
    ial.title = title;
    if (empty) {
        ial[titleEmptyKey] = "true";
    } else {
        delete ial[titleEmptyKey];
    }
    return ial;
};
