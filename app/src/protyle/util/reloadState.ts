export const shouldReloadProtyle = (protyle: Pick<IProtyle, "block" | "options">) =>
    Boolean(protyle.block.rootID || protyle.options.backlinkData);
