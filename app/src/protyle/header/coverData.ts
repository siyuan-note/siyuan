interface CoverEntry {
    file: string;
    category: string;
    photographer: string;
    photographer_url: string;
    pexels_url: string;
    width: number;
    height: number;
}

// manifest 中文类别名 → i18n key 映射
const categoryI18nMap: Record<string, string> = {
    "自然风景": "coverNature",
    "城市夜景": "coverCityNight",
    "古典建筑": "coverClassicalArchitecture",
    "阅读时光": "coverReadingNook",
    "禅意留白": "coverZenMinimal",
    "光影几何": "coverLightGeometry",
    "路与远方": "coverRoadAhead",
    "秋色落叶": "coverAutumnLeaves",
    "灯红酒绿": "coverNeonNights",
    "沙漠戈壁": "coverDesert",
    "极光天象": "coverAurora",
    "晨雾氤氲": "coverMistyMorning",
    "田园乡村": "coverCountryside",
    "茶道文房": "coverTeaCeremony",
    "静谧水面": "coverStillWater",
    "中式园林": "coverChineseGarden",
    "水墨山水": "coverInkWashLandscape",
    "动物生灵": "coverWildlife",
};

function getCategoryLabel(category: string): string {
    const key = categoryI18nMap[category];
    if (key) {
        const label = (window.siyuan.languages as Record<string, string>)[key];
        if (label) {
            return label;
        }
    }
    return category; // 回退到原始中文
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
