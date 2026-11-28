import {escapeHtml} from "../util/escape";

export const flashcardV2FlagColors = ["var(--b3-theme-on-surface)", "#d14343", "#d97706", "#2f9e44", "#3b82f6", "#8b5cf6", "#0891b2", "#db2777"];

const flagNameKeys = ["flashcardNoFlag", "flashcardFlagRed", "flashcardFlagOrange", "flashcardFlagGreen",
    "flashcardFlagBlue", "flashcardFlagPurple", "flashcardFlagCyan", "flashcardFlagPink"];

type FlagName = {flag: number, name: string};

export const flashcardV2FlagLabel = (flag: number, definitions: readonly FlagName[] = []) =>
    (flag !== 0 && definitions.find(definition => definition.flag === flag)?.name) ||
    window.siyuan.languages[flagNameKeys[flag]] || String(flag);

export const flashcardV2FlagMenuItems = (current: number, definitions: readonly FlagName[],
    select: (flag: number) => void): IMenu[] => flashcardV2FlagColors.map((color, flag) => ({
    id: `flashcardV2Flag${flag}`,
    icon: "iconFlag",
    label: escapeHtml(flashcardV2FlagLabel(flag, definitions)),
    checked: current === flag,
    bind: (element) => {
        element.querySelector("svg").style.color = color;
    },
    click: () => {
        if (flag !== current) {
            select(flag);
        }
    },
}));
