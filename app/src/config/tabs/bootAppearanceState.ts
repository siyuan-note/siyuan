export interface IBootAppearanceListItem {
    provider: string;
    appearance: string;
    displayName: string;
    frontends: string[];
}

export interface IBootAppearanceSelection {
    provider: string;
    appearance: string;
}

export const shouldShowBootAppearanceSetting = (
    appearances: IBootAppearanceListItem[],
    current: IBootAppearanceSelection | null | undefined,
    frontend: string,
) => Boolean(current?.provider && current.appearance) ||
    appearances.some((item) => item.frontends?.includes(frontend));
