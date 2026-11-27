import {escapeHtml} from "../util/escape";

export const flashcardV2FlagColors = ["", "#d14343", "#d97706", "#2f9e44", "#3b82f6", "#8b5cf6", "#0891b2", "#db2777"];

export const flashcardV2FlagMenuItems = (current: number, definitions: Array<{flag: number, name: string}>,
    select: (flag: number) => void): IMenu[] => flashcardV2FlagColors.map((color, flag) => ({
    id: `flashcardV2Flag${flag}`,
    icon: flag === 0 ? "iconClose" : "iconBookmark",
    label: escapeHtml(flag === 0 ? window.siyuan.languages.flashcardNoFlag :
        definitions.find((definition) => definition.flag === flag)?.name || String(flag)),
    checked: current === flag,
    bind: (element) => {
        if (color) {
            (element.querySelector("svg") as SVGElement).style.color = color;
        }
    },
    click: () => {
        if (flag !== current) {
            select(flag);
        }
    },
}));
