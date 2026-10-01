import type {Constants} from "../../constants";

export const MOBILE_TOOLBAR_ACTIONS = [
    {name: "add", lang: "addAttr", icon: "iconAdd"},
    {name: "block", lang: "contentBlock", icon: "iconParagraph"},
    {name: "outdent", lang: "outdent", icon: "iconOutdent"},
    {name: "indent", lang: "indent", icon: "iconIndent"},
    {name: "copy", lang: "copy", icon: "iconCopy"},
    {name: "cut", lang: "cut", icon: "iconCut"},
    {name: "softLine", lang: "wrap", icon: "iconSoftWrap"},
    {name: "undo", lang: "undo", icon: "iconUndo"},
    {name: "redo", lang: "redo", icon: "iconRedo"},
    {name: "moveup", lang: "moveToUp", icon: "iconUp"},
    {name: "movedown", lang: "moveToDown", icon: "iconDown"},
];

// 常用插入按钮复用斜杠菜单命令，避免维护另一套内容转换逻辑。
export const MOBILE_TOOLBAR_INSERTS = [
    ...[1, 2, 3, 4, 5, 6].map(level => ({
        name: `heading${level}`, lang: `heading${level}`, icon: `iconH${level}`,
        value: () => `${"#".repeat(level)} ${Lute.Caret}`,
    })),
    {name: "list", lang: "list", icon: "iconList", value: () => `- ${Lute.Caret}`},
    {name: "orderedList", lang: "ordered-list", icon: "iconOrderedList", value: () => `1. ${Lute.Caret}`},
    {name: "check", lang: "check", icon: "iconCheck", value: () => `- [ ] ${Lute.Caret}`},
    {name: "quote", lang: "quote", icon: "iconQuote", value: () => `> ${Lute.Caret}`},
    {name: "codeBlock", lang: "code", icon: "iconCode", value: () => "```"},
    {name: "table", lang: "table", icon: "iconTable", value: () =>
        `| ${Lute.Caret} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`},
    {name: "database", lang: "database", icon: "iconDatabase", value: () =>
        '<div data-type="NodeAttributeView" data-av-type="table"></div>'},
    {name: "mathBlock", lang: "math", icon: "iconMath", value: () => "$$"},
    {name: "tabs", lang: "tabs", icon: "iconTabs", value: () => `::: tabs\n@tab\n\n${Lute.Caret}\n\n@tab\n\n:::\n`},
    {name: "mindmap", lang: "mindmap", icon: "iconMindmap", value: (constants: typeof Constants) =>
        `- ${Lute.Caret}\n{: ${constants.CUSTOM_SY_LIST_MINDMAP}="1"}`},
    {name: "template", lang: "template", icon: "iconMarkdown", value: (constants: typeof Constants) => constants.ZWSP},
    {name: "assets", lang: "assets", icon: "iconImage", value: (constants: typeof Constants) => constants.ZWSP + 2},
];

export const getMobileToolbarActionKey = (name: string) => `mobile-${name}`;
export const MOBILE_TOOLBAR_ACTION_NAMES = [...MOBILE_TOOLBAR_ACTIONS, ...MOBILE_TOOLBAR_INSERTS].map(item => item.name);
