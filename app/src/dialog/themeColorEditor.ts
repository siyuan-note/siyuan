export type TThemeColorEditorType = "color" | "backgroundColor" | "style1";

export interface IThemeColorValue {
    light: {
        color?: string,
        backgroundColor?: string,
    },
    dark: {
        color?: string,
        backgroundColor?: string,
    },
}

const DEFAULT_THEME_COLOR_VALUE: IThemeColorValue = {
    light: {
        color: "#000000",
        backgroundColor: "#fff3cd",
    },
    dark: {
        color: "#ffffff",
        backgroundColor: "#554b00",
    },
};

export const getThemeColorEditorHTML = () => `<div data-type="themeColorEditor" class="b3-label b3-label--inner fn__flex" style="align-items:flex-start;gap:24px;flex-wrap:wrap">
    <div class="fn__flex-1" style="min-width:200px">
        <div>${window.siyuan.languages.themeLight}</div>
        <label class="fn__flex" data-property="color" style="align-items:center;margin-top:8px">
            <span class="fn__flex-1">${window.siyuan.languages.colorFont}</span>
            <input class="b3-text-field" data-field="lightColor" type="color">
        </label>
        <label class="fn__flex" data-property="backgroundColor" style="align-items:center;margin-top:8px">
            <span class="fn__flex-1">${window.siyuan.languages.colorPrimary}</span>
            <input class="b3-text-field" data-field="lightBackgroundColor" type="color">
        </label>
    </div>
    <div class="fn__flex-1" style="min-width:200px">
        <div>${window.siyuan.languages.themeDark}</div>
        <label class="fn__flex" data-property="color" style="align-items:center;margin-top:8px">
            <span class="fn__flex-1">${window.siyuan.languages.colorFont}</span>
            <input class="b3-text-field" data-field="darkColor" type="color">
        </label>
        <label class="fn__flex" data-property="backgroundColor" style="align-items:center;margin-top:8px">
            <span class="fn__flex-1">${window.siyuan.languages.colorPrimary}</span>
            <input class="b3-text-field" data-field="darkBackgroundColor" type="color">
        </label>
    </div>
</div>`;

export const bindThemeColorEditor = (element: Element) => {
    const editorElement = element.matches('[data-type="themeColorEditor"]') ? element :
        element.querySelector('[data-type="themeColorEditor"]');
    const lightColorElement = editorElement.querySelector('[data-field="lightColor"]') as HTMLInputElement;
    const darkColorElement = editorElement.querySelector('[data-field="darkColor"]') as HTMLInputElement;
    const lightBackgroundElement = editorElement.querySelector('[data-field="lightBackgroundColor"]') as HTMLInputElement;
    const darkBackgroundElement = editorElement.querySelector('[data-field="darkBackgroundColor"]') as HTMLInputElement;

    const setType = (type: TThemeColorEditorType) => {
        editorElement.querySelectorAll<HTMLElement>('[data-property="color"]').forEach(item => {
            item.classList.toggle("fn__none", type === "backgroundColor");
        });
        editorElement.querySelectorAll<HTMLElement>('[data-property="backgroundColor"]').forEach(item => {
            item.classList.toggle("fn__none", type === "color");
        });
    };
    const setValue = (value: IThemeColorValue = DEFAULT_THEME_COLOR_VALUE, type: TThemeColorEditorType = "style1") => {
        lightColorElement.value = value.light.color || DEFAULT_THEME_COLOR_VALUE.light.color;
        darkColorElement.value = value.dark.color || DEFAULT_THEME_COLOR_VALUE.dark.color;
        lightBackgroundElement.value = value.light.backgroundColor || DEFAULT_THEME_COLOR_VALUE.light.backgroundColor;
        darkBackgroundElement.value = value.dark.backgroundColor || DEFAULT_THEME_COLOR_VALUE.dark.backgroundColor;
        setType(type);
    };
    const getValue = (type: TThemeColorEditorType = "style1"): IThemeColorValue => {
        const value: IThemeColorValue = {
            light: {},
            dark: {},
        };
        if (type !== "backgroundColor") {
            value.light.color = lightColorElement.value;
            value.dark.color = darkColorElement.value;
        }
        if (type !== "color") {
            value.light.backgroundColor = lightBackgroundElement.value;
            value.dark.backgroundColor = darkBackgroundElement.value;
        }
        return value;
    };

    setValue();
    return {
        getValue,
        setType,
        setValue,
    };
};
