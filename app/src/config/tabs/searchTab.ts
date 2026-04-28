import type {SettingTabBuilder} from "../setting/builder";

const registerSearchQueryGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("query", "");

    group.switchQuery({
        key: "blockType",
        title: window.siyuan.languages.searchBlockType,
        footer: `[1] ${window.siyuan.languages.containerBlockTip1}`,
        items: [
            {kind: "switch", id: "search.mathBlock", label: window.siyuan.languages.math, icon: "iconMath"},
            {kind: "switch", id: "search.table", label: window.siyuan.languages.table, icon: "iconTable"},
            {kind: "switch", id: "search.paragraph", label: window.siyuan.languages.paragraph, icon: "iconParagraph"},
            {kind: "switch", id: "search.heading", label: window.siyuan.languages.headings, icon: "iconHeadings"},
            {kind: "switch", id: "search.codeBlock", label: window.siyuan.languages.code, icon: "iconCode"},
            {kind: "switch", id: "search.htmlBlock", label: "HTML", icon: "iconHTML5"},
            {kind: "switch", id: "search.databaseBlock", label: window.siyuan.languages.database, icon: "iconDatabase"},
            {kind: "switch", id: "search.embedBlock", label: window.siyuan.languages.embedBlock, icon: "iconSQL"},
            {kind: "switch", id: "search.videoBlock", label: window.siyuan.languages.video, icon: "iconVideo"},
            {kind: "switch", id: "search.audioBlock", label: window.siyuan.languages.audio, icon: "iconRecord"},
            {kind: "switch", id: "search.iframeBlock", label: "IFrame", icon: "iconGlobe"},
            {kind: "switch", id: "search.widgetBlock", label: window.siyuan.languages.widget, icon: "iconBoth"},
            {kind: "switch", id: "search.blockquote", label: `${window.siyuan.languages.quote} <sup>[1]</sup>`, icon: "iconQuote"},
            {kind: "switch", id: "search.callout", label: `${window.siyuan.languages.callout} <sup>[1]</sup>`, icon: "iconCallout"},
            {kind: "switch", id: "search.superBlock", label: `${window.siyuan.languages.superBlock} <sup>[1]</sup>`, icon: "iconSuper"},
            {kind: "switch", id: "search.list", label: `${window.siyuan.languages.list1} <sup>[1]</sup>`, icon: "iconList"},
            {kind: "switch", id: "search.listItem", label: `${window.siyuan.languages.listItem} <sup>[1]</sup>`, icon: "iconListItem"},
            {kind: "switch", id: "search.document", label: window.siyuan.languages.doc, icon: "iconFile"},
        ],
    });
    group.switchQuery({
        key: "blockAttr",
        title: window.siyuan.languages.searchBlockAttr,
        items: [
            {kind: "switch", id: "search.name", label: window.siyuan.languages.name, icon: "iconN"},
            {kind: "switch", id: "search.alias", label: window.siyuan.languages.alias, icon: "iconA"},
            {kind: "switch", id: "search.memo", label: window.siyuan.languages.memo, icon: "iconM"},
            {kind: "switch", id: "search.ial", label: window.siyuan.languages.allAttrs},
        ],
    });
    group.switchQuery({
        key: "backmention",
        title: window.siyuan.languages.searchBackmention,
        items: [
            {kind: "switch", id: "search.backlinkMentionName", label: window.siyuan.languages.name},
            {kind: "switch", id: "search.backlinkMentionAlias", label: window.siyuan.languages.alias},
            {kind: "switch", id: "search.backlinkMentionAnchor", label: window.siyuan.languages.anchor},
            {kind: "switch", id: "search.backlinkMentionDoc", label: window.siyuan.languages.docName},
            {kind: "number", id: "search.backlinkMentionKeywordsLimit", label: window.siyuan.languages.keywordsLimit, min: 1, max: 10240},
        ],
    });
    group.switchQuery({
        key: "virtualRef",
        title: window.siyuan.languages.searchVirtualRef,
        items: [
            {kind: "switch", id: "search.virtualRefName", label: window.siyuan.languages.name},
            {kind: "switch", id: "search.virtualRefAlias", label: window.siyuan.languages.alias},
            {kind: "switch", id: "search.virtualRefAnchor", label: window.siyuan.languages.anchor},
            {kind: "switch", id: "search.virtualRefDoc", label: window.siyuan.languages.docName},
        ],
    });
    group.switchQuery({
        key: "index",
        title: window.siyuan.languages.searchIndex,
        items: [
            {kind: "switch", id: "search.indexAssetPath", label: window.siyuan.languages.indexAssetPath},
        ],
    });
};

const registerSearchLimitsGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("limits", "");

    group.number("search.limit", {
        title: window.siyuan.languages.searchLimit,
        desc: `${window.siyuan.languages.searchLimit1}<br>${window.siyuan.languages.searchLimit2}`,
        min: 32,
        max: 10240,
    });
    group.switch("search.caseSensitive", {
        title: window.siyuan.languages.searchCaseSensitive,
        desc: window.siyuan.languages.searchCaseSensitive1,
    });
    group.switch("search.hanSensitive", {
        title: window.siyuan.languages.searchHanSensitive,
        desc: window.siyuan.languages.searchHanSensitive1,
    });
};

export const registerSearchTab = (tab: SettingTabBuilder) => {
    registerSearchQueryGroup(tab);
    registerSearchLimitsGroup(tab);
};
