export const getIconByType = (type: string, sub?: string) => {
    let iconName = "";
    switch (type) {
        case "NodeDocument":
            iconName = "iconFile";
            break;
        case "NodeThematicBreak":
            iconName = "iconLine";
            break;
        case "NodeParagraph":
            iconName = "iconParagraph";
            break;
        case "NodeHeading":
            if (sub) {
                iconName = "icon" + sub.toUpperCase();
            } else {
                iconName = "iconHeadings";
            }
            break;
        case "NodeBlockquote":
            iconName = "iconQuote";
            break;
        case "NodeList":
            if (sub === "t") {
                iconName = "iconCheck";
            } else if (sub === "o") {
                iconName = "iconOrderedList";
            } else {
                iconName = "iconList";
            }
            break;
        case "NodeListItem":
            iconName = "iconListItem";
            break;
        case "NodeCodeBlock":
        case "NodeYamlFrontMatter":
            iconName = "iconCode";
            break;
        case "NodeTable":
            iconName = "iconTable";
            break;
        case "NodeBlockQueryEmbed":
            iconName = "iconSQL";
            break;
        case "NodeSuperBlock":
            iconName = "iconSuper";
            break;
        case "NodeMathBlock":
            iconName = "iconMath";
            break;
        case "NodeHTMLBlock":
            iconName = "iconHTML5";
            break;
        case "NodeWidget":
            iconName = "iconBoth";
            break;
        case "NodeIFrame":
            iconName = "iconLanguage";
            break;
        case "NodeVideo":
            iconName = "iconVideo";
            break;
        case "NodeAudio":
            iconName = "iconRecord";
            break;
    }
    return iconName;
};

export const getIconByElement = (blockElement: HTMLElement) => {
    let iconName = "iconParagraph";
    let iconTitle = window.siyuan.languages.paragraph;
    if (blockElement.tagName.indexOf("H") > -1) {
        iconName = "icon" + blockElement.tagName;
        iconTitle = window.siyuan.languages.headings;
    } else if (blockElement.tagName === "BLOCKQUOTE") {
        iconName = "iconQuote";
        iconTitle = window.siyuan.languages.quote;
    } else if (blockElement.tagName === "TABLE") {
        iconName = "iconTable";
        iconTitle = window.siyuan.languages.table;
    } else if (blockElement.tagName === "UL" || blockElement.tagName === "OL") {
        if (blockElement.firstElementChild.classList.contains("protyle-task")) {
            iconName = "iconCheck";
            iconTitle = window.siyuan.languages.check;
        } else if (blockElement.tagName === "UL") {
            iconName = "iconList";
            iconTitle = window.siyuan.languages.list;
        } else if (blockElement.tagName === "OL") {
            iconName = "iconOrderedList";
            iconTitle = window.siyuan.languages["ordered-list"];
        }
    } else if (blockElement.tagName === "LI") {
        iconName = "iconMenu";
        iconTitle = window.siyuan.languages.listItem;
    } else {
        switch (blockElement.getAttribute("data-type")) {
            case "math-block":
                iconName = "iconMath";
                iconTitle = window.siyuan.languages.math;
                break;
            case "block-query-embed":
                iconName = "iconSQL";
                iconTitle = window.siyuan.languages.blockEmbed;
                break;
            case "super-block":
                iconName = "iconSuper";
                iconTitle = window.siyuan.languages.superBlock;
                break;
            case "html-block":
            case "code-block":
            case "yaml-front-matter":
                iconName = "iconCode";
                iconTitle = window.siyuan.languages.code;
                break;
        }
    }
    return {iconName, iconTitle};
};
