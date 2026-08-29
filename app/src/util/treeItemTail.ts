export const getTreeItemTailHTML = (countHTML: string, actionHTML: string, mobile: boolean) => {
    return mobile ? `${countHTML}${actionHTML}` : `${actionHTML}${countHTML}`;
};
