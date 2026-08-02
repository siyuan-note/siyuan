import {Constants} from "../../constants";
import {merge} from "./merge";
import {hintEmbed, hintRef, hintSlash, hintTag} from "../hint/extend";
import {toolbarKeyToMenu} from "../toolbar/util";
import {isMobile} from "../../util/functions";

export class Options {
    public options: IProtyleOptions;
    private defaultOptions: IProtyleOptions = {
        mode: "wysiwyg",
        blockId: "",
        render: {
            background: false,
            title: false,
            titleShowTop: false,
            hideTitleOnZoom: false,
            gutter: true,
            scroll: false,
            breadcrumb: true,
            breadcrumbDocName: false,
        },
        action: [],
        after: undefined,
        classes: {
            preview: "",
        },
        click: {
            preventInsetEmptyBlock: false
        },
        hint: {
            delay: 200,
            emoji: {
                "+1": "👍",
                "-1": "👎",
                "confused": "😕",
                "eyes": "👀️",
                "heart": "❤️",
                "rocket": "🚀️",
                "smile": "😄",
                "tada": "🎉️",
            },
            emojiPath: "/emojis",
            extend: [{
                key: "((",
                hint: hintRef,
            }, {
                key: "【【",
                hint: hintRef,
            }, {
                key: "（（",
                hint: hintRef,
            }, {
                key: "[[",
                hint: hintRef,
            }, {
                key: "{{",
                hint: hintEmbed,
            }, {
                key: "「「",
                hint: hintEmbed,
            }, {
                key: "「『",
                hint: hintEmbed,
            }, {
                key: "『「",
                hint: hintEmbed,
            }, {
                key: "『『",
                hint: hintEmbed,
            }, {
                key: "#", // 需在 / 之前，否则 #abc/ 会显示菜单
                hint: hintTag,
            }, {
                key: "/",
                hint: hintSlash,
            }, {
                key: "、",
                hint: hintSlash,
            }, {
                key: ":" // 必须在最后一个，否则块引用后的 : 不能被解析
            }],
        },
        preview: {
            actions: ["desktop", "tablet", "mobile", "mp-wechat", "zhihu", "yuque"],
            delay: 0,
            markdown: {
                paragraphBeginningSpace: window.siyuan.config.export.paragraphBeginningSpace,
                listStyle: false,
                sanitize: true,
            },
            mode: "both",
        },
        toolbar: isMobile() ? [
            "block-ref",
            "a",
            "|",
            "text",
            "strong",
            "em",
            "u",
            "clear",
            "|",
            "code",
            "tag",
            "inline-math",
            "inline-memo",
        ] : [
            "block-ref",
            "a",
            "|",
            "text",
            "strong",
            "em",
            "u",
            "s",
            "mark",
            "sup",
            "sub",
            "clear",
            "|",
            "code",
            "kbd",
            "tag",
            "inline-math",
            "inline-memo",
        ],
        typewriterMode: false,
        upload: {
            max: 1024 * 1024 * 1024 * 16,
            url: Constants.UPLOAD_ADDRESS,
            extraData: {},
            fieldName: "file[]",
            filename: (name: string) => name.replace(/[\\/:*?"'<>|\[\]\(\)~!`&{}=#%$]/g, ""),
            linkToImgUrl: "",
            withCredentials: false,
        }
    };

    constructor(options: IProtyleOptions) {
        this.options = options;
    }

    public merge(): IProtyleOptions {
        if (this.options) {
            if (this.options.toolbar) {
                this.options.toolbar = this.mergeToolbar(this.options.toolbar);
            } else {
                this.options.toolbar = this.mergeToolbar(this.defaultOptions.toolbar);
            }
            if (this.options.hint?.emoji) {
                this.defaultOptions.hint.emoji = this.options.hint.emoji;
            }
        }

        return merge(this.defaultOptions, this.options);
    }

    private mergeToolbar(toolbar: Array<string | IMenuItem>) {
        return toolbarKeyToMenu(toolbar);
    }
}
