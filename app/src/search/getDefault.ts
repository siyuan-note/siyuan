
export const getDefaultType = () => {
    return {
        audioBlock: window.siyuan.config.search.audioBlock,
        videoBlock: window.siyuan.config.search.videoBlock,
        iframeBlock: window.siyuan.config.search.iframeBlock,
        widgetBlock: window.siyuan.config.search.widgetBlock,
        document: window.siyuan.config.search.document,
        heading: window.siyuan.config.search.heading,
        list: window.siyuan.config.search.list,
        listItem: window.siyuan.config.search.listItem,
        codeBlock: window.siyuan.config.search.codeBlock,
        htmlBlock: window.siyuan.config.search.htmlBlock,
        mathBlock: window.siyuan.config.search.mathBlock,
        table: window.siyuan.config.search.table,
        blockquote: window.siyuan.config.search.blockquote,
        callout: window.siyuan.config.search.callout,
        superBlock: window.siyuan.config.search.superBlock,
        paragraph: window.siyuan.config.search.paragraph,
        embedBlock: window.siyuan.config.search.embedBlock,
        databaseBlock: window.siyuan.config.search.databaseBlock,
    };
};

export const getDefaultSubType = (): Config.IUILayoutTabSearchConfigSubTypes => {
    return {
        h1: false, h2: false, h3: false, h4: false, h5: false, h6: false,
        o: false, u: false, t: false,
    };
};
