import {Wnd} from "./Wnd";
import {genUUID} from "../util/genID";
import {addResize, fixWndFlex1} from "./util";
import {resizeTabs} from "./tabUtil";
/// #if MOBILE
// 检测移动端是否引入了桌面端的代码
console.error("Need remove unused code");
/// #endif

export class Layout {
    public element: HTMLElement;
    public children?: Array<Layout | Wnd>;
    public parent?: Layout;
    public direction: Config.TUILayoutDirection;
    public type?: Config.TUILayoutType;
    public id?: string;
    public resize?: Config.TUILayoutDirection;
    public size?: string;

    constructor(options?: ILayoutOptions) {
        const mergedOptions: ILayoutOptions = Object.assign({
            direction: "tb",
            size: "auto",
            type: "normal"
        }, options);

        this.id = genUUID();
        this.direction = mergedOptions.direction;
        this.type = mergedOptions.type;
        this.size = mergedOptions.size;
        this.resize = options.resize;
        this.children = [];

        this.element = options.element || document.createElement("div");
        if (this.type === "center") {
            this.element.classList.add("layout__center");
        }
        if (mergedOptions.direction === "tb") {
            this.element.classList.add("fn__flex-column");
        } else {
            this.element.classList.add("fn__flex");
        }
    }

    addLayout(child: Layout, id?: string) {
        if (!id) {
            this.children.splice(this.children.length, 0, child);
            if (this) {
                this.element.append(child.element);
            }
        } else {
            this.children.find((item, index) => {
                if (item.id === id) {
                    this.children.splice(index + 1, 0, child);
                    item.element.after(child.element);
                    return true;
                }
            });
        }
        if (child.size === "auto") {
            child.element.classList.add("fn__flex-1");
        } else {
            child.element.style[(this && this.direction === "lr") ? "width" : "height"] = child.size;
        }
        addResize(child);
        child.parent = this;
    }

    addWnd(child: Wnd, id?: string) {
        if (!id) {
            this.children.splice(this.children.length, 0, child);
            this.element.append(child.element);
        } else {
            this.children.find((item, index) => {
                if (item.id === id) {
                    this.children.splice(index + 1, 0, child);
                    if (this.direction === "lr") {
                        // 向右分屏，左侧文档抖动，移除动画和边距
                        item.element.querySelectorAll(".protyle-content").forEach((element: HTMLElement) => {
                            if (!element.parentElement.classList.contains("fn__none")) {
                                element.classList.remove("protyle-content--transition");
                                (element.querySelector(".protyle-wysiwyg") as HTMLElement).style.padding = "";
                                element.classList.add("protyle-content--transition");
                            }
                        });
                    }
                    item.element.after(child.element);
                    return true;
                }
            });
        }
        if (id) {
            fixWndFlex1(this);
        }
        addResize(child);
        resizeTabs(false);
        child.parent = this;
    }
}
