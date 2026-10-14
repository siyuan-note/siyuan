export interface IMenuDeclaration<Context> {
    id: string;
    label: () => string;
    simple: boolean;
    type: "entry" | "separator";
    icon?: string;
    children?: readonly IMenuDeclaration<Context>[];
    sortable?: boolean;
    fixed?: boolean;
    defaultVisible?: () => boolean;
    simpleDefaultVisible?: boolean;
    customDefaultVisible?: boolean;
    behavior?: (context: Context) => Omit<IMenu, "id" | "label" | "type" | "submenu" | "icon">;
}

export const createDeclaredMenu = <Context>(declaration: IMenuDeclaration<Context>, context: Context): IMenu => ({
    ...declaration.behavior?.(context),
    id: declaration.id,
    label: declaration.label(),
    icon: declaration.icon,
    type: declaration.type === "separator" ? "separator" : undefined,
    submenu: declaration.children?.map(child => createDeclaredMenu(child, context)),
});

// 目录不依赖菜单的运行时上下文，条件隐藏不会改变持久化标识、内置顺序及默认配置。
export interface IDeclaredMenuCatalogNode extends Omit<IMenuDeclaration<never>, "id" | "icon" | "behavior" | "children"> {
    key: string;
    children?: IDeclaredMenuCatalogNode[];
}

export const declaredMenuCatalog = <Context>(declaration: IMenuDeclaration<Context>): IDeclaredMenuCatalogNode => ({
    key: declaration.id,
    label: declaration.label,
    simple: declaration.simple,
    type: declaration.type,
    sortable: declaration.sortable,
    fixed: declaration.fixed,
    defaultVisible: declaration.defaultVisible,
    simpleDefaultVisible: declaration.simpleDefaultVisible,
    customDefaultVisible: declaration.customDefaultVisible,
    children: declaration.children?.map(child => declaredMenuCatalog(child)),
});
