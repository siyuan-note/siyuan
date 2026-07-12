interface CoverEntry {
    file: string;
    category: string;
    photographer: string;
    photographer_url: string;
    pexels_url: string;
    width: number;
    height: number;
}

function getCategoryLabel(category: string): string {
    const label = (window.siyuan.languages as Record<string, string>)[category];
    return label || category;
}

let cachedCovers: CoverEntry[] | null = null;
let cachedCategories: string[] | null = null;
let cachedCoversByCategory: Map<string, CoverEntry[]> | null = null;

async function fetchCoverData(): Promise<{
    categories: string[];
    coversByCategory: Map<string, CoverEntry[]>;
    allCovers: CoverEntry[];
} | null> {
    if (cachedCovers) {
        return {
            categories: cachedCategories!,
            coversByCategory: cachedCoversByCategory!,
            allCovers: cachedCovers,
        };
    }

    try {
        const resp = await fetch("/appearance/covers/manifest.json");
        if (!resp.ok) {
            return null;
        }
        const covers: CoverEntry[] = await resp.json();

        cachedCovers = covers;
        cachedCoversByCategory = new Map();

        for (const cover of covers) {
            const list = cachedCoversByCategory.get(cover.category) || [];
            list.push(cover);
            cachedCoversByCategory.set(cover.category, list);
        }

        // 保持 manifest 中的原始顺序
        cachedCategories = [];
        const seen = new Set<string>();
        for (const cover of covers) {
            if (!seen.has(cover.category)) {
                seen.add(cover.category);
                cachedCategories.push(cover.category);
            }
        }

        return {
            categories: cachedCategories,
            coversByCategory: cachedCoversByCategory,
            allCovers: cachedCovers,
        };
    } catch (e) {
        console.warn("加载封面数据失败", e);
        return null;
    }
}

export { fetchCoverData, getCategoryLabel, CoverEntry };
