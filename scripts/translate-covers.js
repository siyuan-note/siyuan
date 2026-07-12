const fs = require("fs");
const path = require("path");

const trans = {
    en: {
        coverAll: "All",
        coverNature: "Natural Scenery", coverCityNight: "City Night", coverClassicalArchitecture: "Classical Architecture",
        coverReadingNook: "Reading Nook", coverZenMinimal: "Zen Minimal", coverLightGeometry: "Light & Geometry",
        coverRoadAhead: "Road Ahead", coverAutumnLeaves: "Autumn Leaves", coverNeonNights: "Neon Nights",
        coverDesert: "Desert", coverAurora: "Aurora", coverMistyMorning: "Misty Morning",
        coverCountryside: "Countryside", coverTeaCeremony: "Tea Ceremony", coverStillWater: "Still Water",
        coverChineseGarden: "Chinese Garden", coverInkWashLandscape: "Ink Wash Landscape", coverWildlife: "Wildlife"
    },
    "zh-CN": {
        coverAll: "全部",
        coverNature: "自然风景", coverCityNight: "城市夜景", coverClassicalArchitecture: "古典建筑",
        coverReadingNook: "阅读时光", coverZenMinimal: "禅意留白", coverLightGeometry: "光影几何",
        coverRoadAhead: "路与远方", coverAutumnLeaves: "秋色落叶", coverNeonNights: "灯红酒绿",
        coverDesert: "沙漠戈壁", coverAurora: "极光天象", coverMistyMorning: "晨雾氤氲",
        coverCountryside: "田园乡村", coverTeaCeremony: "茶道文房", coverStillWater: "静谧水面",
        coverChineseGarden: "中式园林", coverInkWashLandscape: "水墨山水", coverWildlife: "动物生灵"
    },
    "zh-TW": {
        coverAll: "全部",
        coverNature: "自然風景", coverCityNight: "城市夜景", coverClassicalArchitecture: "古典建築",
        coverReadingNook: "閱讀時光", coverZenMinimal: "禪意留白", coverLightGeometry: "光影幾何",
        coverRoadAhead: "路與遠方", coverAutumnLeaves: "秋色落葉", coverNeonNights: "燈紅酒綠",
        coverDesert: "沙漠戈壁", coverAurora: "極光天象", coverMistyMorning: "晨霧氤氳",
        coverCountryside: "田園鄉村", coverTeaCeremony: "茶道文房", coverStillWater: "靜謐水面",
        coverChineseGarden: "中式園林", coverInkWashLandscape: "水墨山水", coverWildlife: "動物生靈"
    },
    ja: {
        coverAll: "すべて",
        coverNature: "自然風景", coverCityNight: "都会の夜景", coverClassicalArchitecture: "古典建築",
        coverReadingNook: "読書の時間", coverZenMinimal: "禅の余白", coverLightGeometry: "光の幾何学",
        coverRoadAhead: "彼方への道", coverAutumnLeaves: "秋の紅葉", coverNeonNights: "ネオンの夜",
        coverDesert: "砂漠", coverAurora: "オーロラ", coverMistyMorning: "霧の朝",
        coverCountryside: "田園風景", coverTeaCeremony: "茶道と書斎", coverStillWater: "静かな水面",
        coverChineseGarden: "中国庭園", coverInkWashLandscape: "水墨山水", coverWildlife: "野生動物"
    },
    ko: {
        coverAll: "전체",
        coverNature: "자연 풍경", coverCityNight: "도시의 밤", coverClassicalArchitecture: "고전 건축",
        coverReadingNook: "독서 시간", coverZenMinimal: "젠 미니멀", coverLightGeometry: "빛의 기하학",
        coverRoadAhead: "저편의 길", coverAutumnLeaves: "가을 낙엽", coverNeonNights: "네온의 밤",
        coverDesert: "사막", coverAurora: "오로라", coverMistyMorning: "안개 낀 아침",
        coverCountryside: "전원 풍경", coverTeaCeremony: "다도와 서재", coverStillWater: "고요한 수면",
        coverChineseGarden: "중국 정원", coverInkWashLandscape: "수묵 산수", coverWildlife: "야생 동물"
    },
    de: {
        coverAll: "Alle",
        coverNature: "Naturlandschaft", coverCityNight: "Stadt bei Nacht", coverClassicalArchitecture: "Klassische Architektur",
        coverReadingNook: "Leseecke", coverZenMinimal: "Zen-Minimalismus", coverLightGeometry: "Licht & Geometrie",
        coverRoadAhead: "Weg in die Ferne", coverAutumnLeaves: "Herbstlaub", coverNeonNights: "Neon-Nächte",
        coverDesert: "Wüste", coverAurora: "Polarlichter", coverMistyMorning: "Nebliger Morgen",
        coverCountryside: "Landleben", coverTeaCeremony: "Teezeremonie", coverStillWater: "Stilles Wasser",
        coverChineseGarden: "Chinesischer Garten", coverInkWashLandscape: "Tuschelandschaft", coverWildlife: "Wildtiere"
    },
    fr: {
        coverAll: "Tout",
        coverNature: "Paysage naturel", coverCityNight: "Ville la nuit", coverClassicalArchitecture: "Architecture classique",
        coverReadingNook: "Coin lecture", coverZenMinimal: "Minimalisme zen", coverLightGeometry: "Lumi\u00e8re et g\u00e9om\u00e9trie",
        coverRoadAhead: "Route vers l\u2019horizon", coverAutumnLeaves: "Feuilles d\u2019automne", coverNeonNights: "Nuits au n\u00e9on",
        coverDesert: "D\u00e9sert", coverAurora: "Aurore bor\u00e9ale", coverMistyMorning: "Matin brumeux",
        coverCountryside: "Campagne", coverTeaCeremony: "C\u00e9r\u00e9monie du th\u00e9", coverStillWater: "Eau calme",
        coverChineseGarden: "Jardin chinois", coverInkWashLandscape: "Lavis d\u2019encre", coverWildlife: "Faune sauvage"
    },
    es: {
        coverAll: "Todo",
        coverNature: "Paisaje natural", coverCityNight: "Ciudad de noche", coverClassicalArchitecture: "Arquitectura cl\u00e1sica",
        coverReadingNook: "Rinc\u00f3n de lectura", coverZenMinimal: "Minimalismo zen", coverLightGeometry: "Luz y geometr\u00eda",
        coverRoadAhead: "Camino al horizonte", coverAutumnLeaves: "Hojas de oto\u00f1o", coverNeonNights: "Noches de ne\u00f3n",
        coverDesert: "Desierto", coverAurora: "Aurora boreal", coverMistyMorning: "Ma\u00f1ana brumosa",
        coverCountryside: "Campo", coverTeaCeremony: "Ceremonia del t\u00e9", coverStillWater: "Agua tranquila",
        coverChineseGarden: "Jard\u00edn chino", coverInkWashLandscape: "Pintura a tinta", coverWildlife: "Vida salvaje"
    },
    it: {
        coverAll: "Tutto",
        coverNature: "Paesaggio naturale", coverCityNight: "Citt\u00e0 di notte", coverClassicalArchitecture: "Architettura classica",
        coverReadingNook: "Angolo lettura", coverZenMinimal: "Minimalismo zen", coverLightGeometry: "Luce e geometria",
        coverRoadAhead: "Strada verso l\u2019orizzonte", coverAutumnLeaves: "Foglie d\u2019autunno", coverNeonNights: "Notti al neon",
        coverDesert: "Deserto", coverAurora: "Aurora boreale", coverMistyMorning: "Mattina nebbiosa",
        coverCountryside: "Campagna", coverTeaCeremony: "Cerimonia del t\u00e8", coverStillWater: "Acqua calma",
        coverChineseGarden: "Giardino cinese", coverInkWashLandscape: "Paesaggio a inchiostro", coverWildlife: "Fauna selvatica"
    },
    "pt-BR": {
        coverAll: "Tudo",
        coverNature: "Paisagem natural", coverCityNight: "Cidade \u00e0 noite", coverClassicalArchitecture: "Arquitetura cl\u00e1ssica",
        coverReadingNook: "Canto de leitura", coverZenMinimal: "Minimalismo zen", coverLightGeometry: "Luz e geometria",
        coverRoadAhead: "Estrada para o horizonte", coverAutumnLeaves: "Folhas de outono", coverNeonNights: "Noites de neon",
        coverDesert: "Deserto", coverAurora: "Aurora boreal", coverMistyMorning: "Manh\u00e3 enevoada",
        coverCountryside: "Campo", coverTeaCeremony: "Cerim\u00f4nia do ch\u00e1", coverStillWater: "\u00c1gua tranquila",
        coverChineseGarden: "Jardim chin\u00eas", coverInkWashLandscape: "Pintura a nanquim", coverWildlife: "Vida selvagem"
    },
    ru: {
        coverAll: "\u0412\u0441\u0435",
        coverNature: "\u041f\u0440\u0438\u0440\u043e\u0434\u0430", coverCityNight: "\u041d\u043e\u0447\u043d\u043e\u0439 \u0433\u043e\u0440\u043e\u0434", coverClassicalArchitecture: "\u041a\u043b\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430",
        coverReadingNook: "\u0423\u0433\u043e\u043b\u043e\u043a \u0434\u043b\u044f \u0447\u0442\u0435\u043d\u0438\u044f", coverZenMinimal: "\u0414\u0437\u0435\u043d-\u043c\u0438\u043d\u0438\u043c\u0430\u043b\u0438\u0437\u043c", coverLightGeometry: "\u0421\u0432\u0435\u0442 \u0438 \u0433\u0435\u043e\u043c\u0435\u0442\u0440\u0438\u044f",
        coverRoadAhead: "\u0414\u043e\u0440\u043e\u0433\u0430 \u0432\u0434\u0430\u043b\u044c", coverAutumnLeaves: "\u041e\u0441\u0435\u043d\u043d\u0438\u0435 \u043b\u0438\u0441\u0442\u044c\u044f", coverNeonNights: "\u041d\u0435\u043e\u043d\u043e\u0432\u044b\u0435 \u043d\u043e\u0447\u0438",
        coverDesert: "\u041f\u0443\u0441\u0442\u044b\u043d\u044f", coverAurora: "\u0421\u0435\u0432\u0435\u0440\u043d\u043e\u0435 \u0441\u0438\u044f\u043d\u0438\u0435", coverMistyMorning: "\u0422\u0443\u043c\u0430\u043d\u043d\u043e\u0435 \u0443\u0442\u0440\u043e",
        coverCountryside: "\u0414\u0435\u0440\u0435\u0432\u043d\u044f", coverTeaCeremony: "\u0427\u0430\u0439\u043d\u0430\u044f \u0446\u0435\u0440\u0435\u043c\u043e\u043d\u0438\u044f", coverStillWater: "\u0422\u0438\u0445\u0430\u044f \u0432\u043e\u0434\u0430",
        coverChineseGarden: "\u041a\u0438\u0442\u0430\u0439\u0441\u043a\u0438\u0439 \u0441\u0430\u0434", coverInkWashLandscape: "\u0422\u0443\u0448\u0435\u0432\u043e\u0439 \u043f\u0435\u0439\u0437\u0430\u0436", coverWildlife: "\u0414\u0438\u043a\u0430\u044f \u043f\u0440\u0438\u0440\u043e\u0434\u0430"
    },
    pl: {
        coverAll: "Wszystko",
        coverNature: "Przyroda", coverCityNight: "Miasto noc\u0105", coverClassicalArchitecture: "Architektura klasyczna",
        coverReadingNook: "K\u0105cik do czytania", coverZenMinimal: "Minimalizm zen", coverLightGeometry: "\u015awiat\u0142o i geometria",
        coverRoadAhead: "Droga w dal", coverAutumnLeaves: "Jesienne li\u015bcie", coverNeonNights: "Neonowe noce",
        coverDesert: "Pustynia", coverAurora: "Zorza polarna", coverMistyMorning: "Mglisty poranek",
        coverCountryside: "Wie\u015b", coverTeaCeremony: "Ceremonia herbaty", coverStillWater: "Spokojna woda",
        coverChineseGarden: "Chi\u0144ski ogr\u00f3d", coverInkWashLandscape: "Pejza\u017c tuszem", coverWildlife: "Dzika przyroda"
    },
    nl: {
        coverAll: "Alles",
        coverNature: "Natuurlandschap", coverCityNight: "Stad bij nacht", coverClassicalArchitecture: "Klassieke architectuur",
        coverReadingNook: "Leeshoek", coverZenMinimal: "Zen-minimalisme", coverLightGeometry: "Licht & geometrie",
        coverRoadAhead: "Weg naar de horizon", coverAutumnLeaves: "Herfstbladeren", coverNeonNights: "Neon-nachten",
        coverDesert: "Woestijn", coverAurora: "Noorderlicht", coverMistyMorning: "Mistige ochtend",
        coverCountryside: "Platteland", coverTeaCeremony: "Theeceremonie", coverStillWater: "Stil water",
        coverChineseGarden: "Chinese tuin", coverInkWashLandscape: "Inktwaslandschap", coverWildlife: "Wilde dieren"
    },
    tr: {
        coverAll: "T\u00fcm\u00fc",
        coverNature: "Do\u011fa Manzaras\u0131", coverCityNight: "Gece \u015eehir", coverClassicalArchitecture: "Klasik Mimari",
        coverReadingNook: "Okuma K\u00f6\u015fesi", coverZenMinimal: "Zen Minimal", coverLightGeometry: "I\u015f\u0131k ve Geometri",
        coverRoadAhead: "Ufka Giden Yol", coverAutumnLeaves: "Sonbahar Yapraklar\u0131", coverNeonNights: "Neon Geceler",
        coverDesert: "\u00c7\u00f6l", coverAurora: "Kuzey I\u015f\u0131klar\u0131", coverMistyMorning: "Sisli Sabah",
        coverCountryside: "K\u0131rsal", coverTeaCeremony: "\u00c7ay T\u00f6reni", coverStillWater: "Durgun Su",
        coverChineseGarden: "\u00c7in Bah\u00e7esi", coverInkWashLandscape: "M\u00fcrekkep Manzara", coverWildlife: "Vah\u015fi Ya\u015fam"
    },
    uk: {
        coverAll: "\u0412\u0441\u0435",
        coverNature: "\u041f\u0440\u0438\u0440\u043e\u0434\u0430", coverCityNight: "\u041d\u0456\u0447\u043d\u0435 \u043c\u0456\u0441\u0442\u043e", coverClassicalArchitecture: "\u041a\u043b\u0430\u0441\u0438\u0447\u043d\u0430 \u0430\u0440\u0445\u0456\u0442\u0435\u043a\u0442\u0443\u0440\u0430",
        coverReadingNook: "\u041a\u0443\u0442\u043e\u0447\u043e\u043a \u0434\u043b\u044f \u0447\u0438\u0442\u0430\u043d\u043d\u044f", coverZenMinimal: "\u0414\u0437\u0435\u043d-\u043c\u0456\u043d\u0456\u043c\u0430\u043b\u0456\u0437\u043c", coverLightGeometry: "\u0421\u0432\u0456\u0442\u043b\u043e \u0456 \u0433\u0435\u043e\u043c\u0435\u0442\u0440\u0456\u044f",
        coverRoadAhead: "\u0414\u043e\u0440\u043e\u0433\u0430 \u0432\u0434\u0430\u043b\u0438\u043d\u0443", coverAutumnLeaves: "\u041e\u0441\u0456\u043d\u043d\u0454 \u043b\u0438\u0441\u0442\u044f", coverNeonNights: "\u041d\u0435\u043e\u043d\u043e\u0432\u0456 \u043d\u043e\u0447\u0456",
        coverDesert: "\u041f\u0443\u0441\u0442\u0435\u043b\u044f", coverAurora: "\u041f\u0456\u0432\u043d\u0456\u0447\u043d\u0435 \u0441\u044f\u0439\u0432\u043e", coverMistyMorning: "\u0422\u0443\u043c\u0430\u043d\u043d\u0438\u0439 \u0440\u0430\u043d\u043e\u043a",
        coverCountryside: "\u0421\u0435\u043b\u043e", coverTeaCeremony: "\u0427\u0430\u0439\u043d\u0430 \u0446\u0435\u0440\u0435\u043c\u043e\u043d\u0456\u044f", coverStillWater: "\u0422\u0438\u0445\u0430 \u0432\u043e\u0434\u0430",
        coverChineseGarden: "\u041a\u0438\u0442\u0430\u0439\u0441\u044c\u043a\u0438\u0439 \u0441\u0430\u0434", coverInkWashLandscape: "\u0422\u0443\u0448\u043e\u0432\u0438\u0439 \u043f\u0435\u0439\u0437\u0430\u0436", coverWildlife: "\u0414\u0438\u043a\u0430 \u043f\u0440\u0438\u0440\u043e\u0434\u0430"
    }
};

const langDir = "app/appearance/langs";
const files = fs.readdirSync(langDir).filter(f => f.endsWith(".json"));
const keys = ["coverAll", "coverNature", "coverCityNight", "coverClassicalArchitecture", "coverReadingNook",
    "coverZenMinimal", "coverLightGeometry", "coverRoadAhead", "coverAutumnLeaves", "coverNeonNights",
    "coverDesert", "coverAurora", "coverMistyMorning", "coverCountryside", "coverTeaCeremony",
    "coverStillWater", "coverChineseGarden", "coverInkWashLandscape", "coverWildlife"
];

for (const file of files) {
    const fp = path.join(langDir, file);
    let c = fs.readFileSync(fp, "utf8");
    const lang = file.replace(".json", "");
    const t = trans[lang] || trans.en;
    for (const key of keys) {
        if (t[key]) {
            c = c.replace(new RegExp("\"" + key + "\": \"[^\"]*\""), "\"" + key + "\": \"" + t[key] + "\"");
        }
    }
    fs.writeFileSync(fp, c, "utf8");
}
console.log("Done");
