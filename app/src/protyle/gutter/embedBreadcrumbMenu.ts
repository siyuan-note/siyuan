import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {blockRender} from "../render/blockRender";

export const embedBreadcrumbMenu = (protyle: IProtyle, nodeElement: Element): IMenu[] =>
    [
        {id: "embedBlockBreadcrumb", attribute: "breadcrumb"},
        {id: "embedBlockBreadcrumbParentPath", attribute: Constants.CUSTOM_SY_EMBED_BREADCRUMB_PARENT_PATH},
    ].map(({id, attribute}): IMenu => {
        const current = nodeElement.getAttribute(attribute);
        return {
            id,
            label: window.siyuan.languages[id],
            iconHTML: "",
            type: "submenu",
            submenu: [
                {id: "enable", value: "true"},
                {id: "disable", value: "false"},
                {id: "default", value: null},
            ].map(({id: option, value}) => ({
                id: option,
                label: window.siyuan.languages[option],
                iconHTML: "",
                checked: value === null ? current !== "true" && current !== "false" : current === value,
                click() {
                    fetchPost("/api/attr/setBlockAttrs", {
                        id: nodeElement.getAttribute("data-node-id"), attrs: {[attribute]: value},
                    }, () => {
                        if (value === null) nodeElement.removeAttribute(attribute);
                        else nodeElement.setAttribute(attribute, value);
                        nodeElement.removeAttribute("data-render");
                        blockRender(protyle, nodeElement);
                    });
                },
            })),
        };
    });
