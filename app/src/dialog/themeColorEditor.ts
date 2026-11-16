import {createColorField} from "../colorPicker/field";

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

const getThemeColorGroupHTML = (title: string, colorField: string, backgroundField: string) =>
    `<div class="fn__flex-1">
        <div>${title}</div>
        <div class="fn__hr"></div>
        <div data-property="color">
            <span class="fn__flex-center">${window.siyuan.languages.colorFont}</span>
            <span class="fn__space"></span>
            <div data-field="${colorField}"></div>
        </div>
        <div class="fn__hr"></div>
        <div data-property="backgroundColor">
            <span class="fn__flex-center">${window.siyuan.languages.colorPrimary}</span>
            <span class="fn__space"></span>
            <div data-field="${backgroundField}"></div>
        </div>
    </div>`;

export const getThemeColorEditorHTML = () => `<div data-type="themeColorEditor" class="b3-label b3-label--inner fn__flex fn__flex-wrap">
    ${getThemeColorGroupHTML(window.siyuan.languages.themeLight, "lightColor", "lightBackgroundColor")}
    <div class="fn__space"></div>
    ${getThemeColorGroupHTML(window.siyuan.languages.themeDark, "darkColor", "darkBackgroundColor")}
</div>`;

export const bindThemeColorEditor = (element: Element) => {
    const editorElement = element.matches('[data-type="themeColorEditor"]') ? element :
        element.querySelector('[data-type="themeColorEditor"]');
    const fields = (["light", "dark"] as const).flatMap(theme => (["color", "backgroundColor"] as const).map(property => {
        const name = theme + (property === "color" ? "Color" : "BackgroundColor");
        const host = editorElement.querySelector<HTMLElement>(`[data-field="${name}"]`);
        return {theme, property, field: createColorField(host, {
            value: DEFAULT_THEME_COLOR_VALUE[theme][property], languages: window.siyuan.languages,
            label: property === "color" ? window.siyuan.languages.colorFont : window.siyuan.languages.colorPrimary,
            onPreview: () => host.dispatchEvent(new host.ownerDocument.defaultView.Event("input", {bubbles: true})),
        })};
    }));
    let currentType: TThemeColorEditorType = "style1";
    const enabled = {color: true, backgroundColor: true};
    const updateEnabled = () => fields.forEach(({property, field}) => {
        field.setEnabled(enabled[property] && (currentType === "style1" || currentType === property));
    });

    const setType = (type: TThemeColorEditorType) => {
        currentType = type;
        editorElement.querySelectorAll<HTMLElement>('[data-property="color"]').forEach(item => {
            item.classList.toggle("fn__none", type === "backgroundColor");
        });
        editorElement.querySelectorAll<HTMLElement>('[data-property="backgroundColor"]').forEach(item => {
            item.classList.toggle("fn__none", type === "color");
        });
        updateEnabled();
    };
    const setValue = (value: IThemeColorValue = DEFAULT_THEME_COLOR_VALUE, type: TThemeColorEditorType = "style1") => {
        fields.forEach(({theme, property, field}) => field.setValue(value[theme][property] || DEFAULT_THEME_COLOR_VALUE[theme][property]));
        setType(type);
    };
    const getValue = (type: TThemeColorEditorType = "style1"): IThemeColorValue => {
        const value: IThemeColorValue = {
            light: {},
            dark: {},
        };
        if (type !== "backgroundColor") {
            fields.filter(item => item.property === "color").forEach(({theme, field}) => value[theme].color = field.getValue().hex);
        }
        if (type !== "color") {
            fields.filter(item => item.property === "backgroundColor").forEach(({theme, field}) => value[theme].backgroundColor = field.getValue().hex);
        }
        return value;
    };

    setValue();
    return {
        getValue,
        setType,
        setValue,
        setEnabled: (property: "color" | "backgroundColor", value: boolean) => {
            if (enabled[property] !== value) {
                fields.filter(item => item.property === property).forEach(({field}) => field.setValue(field.getValue().hex));
            }
            enabled[property] = value;
            updateEnabled();
        },
        commitDraft: (type: TThemeColorEditorType = currentType) => {
            const participating = fields.filter(item => enabled[item.property] && (type === "style1" || item.property === type));
            const invalid = participating.find(item => item.field.validate() !== "valid");
            if (invalid) { invalid.field.focusError(); return undefined; }
            participating.forEach(item => item.field.commitDraft());
            return getValue(type);
        },
        destroy: () => fields.forEach(item => item.field.destroy()),
    };
};
