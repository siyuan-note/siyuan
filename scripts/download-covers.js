/**
 * 从 Pexels 下载题头图封面图片
 *
 * 用法：
 *   1. 到 https://www.pexels.com/api/ 注册免费 API Key
 *   2. 设置环境变量：set PEXELS_API_KEY=你的key   (Windows cmd)
 *                       $env:PEXELS_API_KEY="你的key" (PowerShell)
 *                       export PEXELS_API_KEY=你的key  (Git Bash / Linux / macOS)
 *   3. 运行：node scripts/download-covers.js
 *
 * 参数（可选）：
 *   --count=N     总下载数量（默认 9）
 *   --dir=PATH    输出目录（默认 app/appearance/covers）
 */

const fs = require("fs");
const path = require("path");
const sharp = require(path.resolve(__dirname, "..", "app", "node_modules", "sharp"));

const API_KEY = process.env.PEXELS_API_KEY;
if (!API_KEY) {
    console.error("❌ 请设置 PEXELS_API_KEY 环境变量");
    console.error("   免费注册：https://www.pexels.com/api/");
    process.exit(1);
}

// 解析命令行参数
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const found = args.find(a => a.startsWith(`--${name}=`));
    return found ? found.split("=")[1] : fallback;
};
const TOTAL = parseInt(getArg("count", "72"), 10);
const OUT_DIR = path.resolve(__dirname, "..", getArg("dir", "app/appearance/covers"));

// 搜索类别：每类取等量图片
const SEARCH_QUERIES = [
    { query: "epic mountain landscape photography", label: "自然风景", key: "coverNature" },
    { query: "city night skyline blue hour", label: "城市夜景", key: "coverCityNight" },
    { query: "classical architecture cathedral historic", label: "古典建筑", key: "coverClassicalArchitecture" },
    { query: "cozy reading nook books candle", label: "阅读时光", key: "coverReadingNook" },
    { query: "zen garden minimal calm aesthetic", label: "禅意留白", key: "coverZenMinimal" },
    { query: "architecture light shadow geometry", label: "光影几何", key: "coverLightGeometry" },
    { query: "winding road path journey landscape", label: "路与远方", key: "coverRoadAhead" },
    { query: "autumn fall leaves colorful forest", label: "秋色落叶", key: "coverAutumnLeaves" },
    { query: "neon lights night city vibrant colorful", label: "灯红酒绿", key: "coverNeonNights" },
    { query: "desert sand dune arid landscape", label: "沙漠戈壁", key: "coverDesert" },
    { query: "aurora borealis northern lights sky", label: "极光天象", key: "coverAurora" },
    { query: "morning mist fog valley mountain", label: "晨雾氤氲", key: "coverMistyMorning" },
    { query: "countryside rural farm meadow peaceful", label: "田园乡村", key: "coverCountryside" },
    { query: "tea ceremony calligraphy writing desk", label: "茶道文房", key: "coverTeaCeremony" },
    { query: "calm lake reflection mirror water still", label: "静谧水面", key: "coverStillWater" },
    { query: "chinese garden pavilion architecture", label: "中式园林", key: "coverChineseGarden" },
    { query: "karst mountain mist landscape china", label: "水墨山水", key: "coverInkWashLandscape" },
    { query: "wildlife animal deer fox bird nature", label: "动物生灵", key: "coverWildlife" },
];
const PER_QUERY = Math.ceil(TOTAL / SEARCH_QUERIES.length);

/**
 * 调用 Pexels API 搜索图片
 */
async function searchPhotos(query, perPage) {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape&size=medium`;
    const resp = await fetch(url, {
        headers: { Authorization: API_KEY },
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Pexels API 请求失败 (${resp.status}): ${text}`);
    }
    const data = await resp.json();
    return data.photos || [];
}

/**
 * 下载单张图片
 */
async function downloadPhoto(photo, outDir, index) {
    // 从 Pexels 取原图，由 sharp 统一裁切到 2x Retina 尺寸
    const width = 2400;
    const height = 800;
    const imgUrl = photo.src.original;

    const filename = `cover_${String(index).padStart(3, "0")}.webp`;
    const filePath = path.join(outDir, filename);

    console.log(`  📥 下载：${filename} ← ${photo.photographer} / Pexels`);

    const imgResp = await fetch(imgUrl);
    if (!imgResp.ok) {
        throw new Error(`下载图片失败 (${imgResp.status}): ${imgUrl}`);
    }
    const inputBuffer = Buffer.from(await imgResp.arrayBuffer());

    // 转换为 webp
    const outputBuffer = await sharp(inputBuffer)
        .resize(width, height, { fit: "cover" })
        .webp({ quality: 85 })
        .toBuffer();

    fs.writeFileSync(filePath, outputBuffer);

    const kb = (outputBuffer.length / 1024).toFixed(1);
    console.log(`     ✅ ${filename}（${kb} KB）`);

    return {
        file: filename,
        category: photo.alt || "",
        photographer: photo.photographer,
        photographer_url: photo.photographer_url,
        pexels_url: photo.url,
        width,
        height,
    };
}

async function main() {
    console.log(`🎨 开始下载题头图封面图片（共 ${TOTAL} 张）...\n`);

    // 创建输出目录
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // 全局去重集合（按 photo id）
    const seen = new Set();
    let allPhotos = [];

    for (const { query, label, key } of SEARCH_QUERIES) {
        console.log(`🔍 搜索「${label}」...`);
        const photos = await searchPhotos(query, PER_QUERY * 2); // 多取一些，去重后有足够余量
        // 去重：全局 ID + 类内摄影师
        let categoryPhotos = [];
        const categoryPhotographers = new Set();
        for (const p of photos) {
            if (seen.has(p.id)) continue;
            if (categoryPhotographers.has(p.photographer)) continue; // 同一类别避免同一摄影师
            seen.add(p.id);
            categoryPhotographers.add(p.photographer);
            p._category = key;
            categoryPhotos.push(p);
        }
        // 每个类别取 PER_QUERY 张
        categoryPhotos = categoryPhotos.slice(0, PER_QUERY);
        allPhotos = allPhotos.concat(categoryPhotos);
        console.log(`   找到 ${photos.length} 张，去重后选取 ${categoryPhotos.length} 张`);
    }

    if (allPhotos.length < TOTAL) {
        console.warn(`⚠️  只找到 ${allPhotos.length} 张（目标 ${TOTAL} 张），将下载全部可用图片`);
    }

    // 下载图片
    console.log(`\n📦 下载 ${allPhotos.length} 张图片到 ${OUT_DIR} ...\n`);
    const manifest = [];
    for (let i = 0; i < allPhotos.length; i++) {
        try {
            const entry = await downloadPhoto(allPhotos[i], OUT_DIR, i + 1);
            entry.category = allPhotos[i]._category;
            manifest.push(entry);
        } catch (err) {
            console.error(`   ❌ 下载失败：${err.message}`);
        }
    }

    // 写 manifest
    const manifestPath = path.join(OUT_DIR, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "  "), "utf-8");
    console.log(`\n📋 manifest.json 已生成（${manifest.length} 条记录）`);

    console.log("\n✨ 下载完成！图片位于：");
    console.log(`   ${OUT_DIR}`);
    console.log("\n💡 可以用浏览器直接打开图片查看效果");
    console.log("   满意后执行第二步：修改 Background.ts 集成到题头图对话框\n");
}

main().catch(err => {
    console.error("❌ 脚本执行失败：", err.message);
    process.exit(1);
});
