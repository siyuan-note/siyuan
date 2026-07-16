// 桌面端 pre-boot 窗口（init.html / workspace.html）共享脚本
// 由各 HTML 通过 <script src="window.js"></script> 引入，依赖 nodeIntegration: true
// 中文用 ld246.com，其他语言用 liuyun.io
"use strict";

// 解析 URL query 参数
const getSearch = (key) => {
    if (window.location.search.indexOf("?") === -1) {
        return "";
    }
    let value = "";
    const data = window.location.search.split("?")[1].split("&");
    data.find(item => {
        const keyValue = item.split("=");
        if (keyValue[0] === key) {
            value = keyValue[1];
            return true;
        }
    });
    return value;
};

// 多语言文案，集中维护所有窗口的全部文案
const I18N_BASE = {
    "zh-CN": {
        title: "思源笔记",
        crashTip: "⚠️ 检测到渲染进程曾异常退出，可能与插件、代码片段或自定义主题和图标有关，建议以安全模式启动。安全模式会禁用所有插件和代码片段，并切换为默认主题和图标；相关内容不会被删除，但这些设置需要在启动后手动恢复。",
        safeModeBtn: "🛡️ 安全模式启动",
        normalBtn: "正常启动",
        slogan: "重构你的思维",
        wsTitle: "工作空间",
        missingTip: "⚠️ 找不到上次打开的工作空间路径",
        emptyHint: "当前没有可用的工作空间，请选择新的工作空间路径",
        selectPath: "🗂️ 选择新的工作空间路径",
        selectPathDesc: "工作空间用于存放数据，后续可以在顶栏左上角的主菜单中进行切换",
        workspace: "🗂️ 工作空间",
        workspaceDesc: "工作空间用于存放数据，后续可以在顶栏左上角的主菜单中进行切换",
        notice: "⚠️ 请勿使用第三方同步盘同步数据，否则会导致运行异常和数据损坏",
        open: "打开",
        selectBtn: "选择",
        lang: "🌐 外观语言",
        langDesc: "用户界面语言，后续可以在 <kbd>设置</kbd> - <kbd>外观</kbd> 中进行切换",
        feedback: "求助反馈建议",
        community: "用户社区汇总",
        download: "下载最新版",
        feedbackUrl: "https://ld246.com/article/1649901726096",
        communityUrl: "https://ld246.com/article/1640266171309",
        downloadUrl: "https://b3log.org/siyuan/download.html",
        msgPartitionRoot: "⚠️ 请勿在分区根路径上创建工作空间，请新建一个文件夹作为工作空间",
        msgNotEmpty: "⚠️ 该文件夹包含了其他文件，请新建一个文件夹作为工作空间",
        msgICloud: "⚠️ 该文件夹位于 iCloud 同步路径下，请更换其他路径",
        msgCloudDrive: "⚠️ 文件夹路径不能包含 onedrive、dropbox、google drive、pcloud、nutstore、baidunetdisk、weiyun、坚果云、百度网盘和腾讯微云等字样，请更换其他路径",
        msgConfirm: "⚠️ 请确认没有将工作空间设置在第三方同步盘路径下，否则会造成数据损坏（iCloud/OneDrive/Dropbox/Google Drive/坚果云/百度网盘/腾讯微云等），是否继续？",
    },
    "zh-TW": {
        title: "思源筆記",
        crashTip: "⚠️ 偵測到渲染處理程序曾異常結束，可能與外掛、程式碼片段或自訂主題和圖示有關。建議以安全模式啟動。安全模式會停用所有外掛和程式碼片段，並切換為預設主題和圖示；相關內容不會被刪除，但這些設定需要在啟動後手動還原。",
        safeModeBtn: "🛡️ 安全模式啟動",
        normalBtn: "正常啟動",
        slogan: "重構你的思維",
        wsTitle: "工作空間",
        missingTip: "⚠️ 找不到上次開啟的工作空間路徑",
        emptyHint: "目前沒有可用的工作空間，請選擇新的工作空間路徑",
        selectPath: "🗂️ 選擇新的工作空間路徑",
        selectPathDesc: "工作空間用於存放資料，後續可以在頂欄左上角的主選單中進行切換",
        workspace: "🗂️ 工作空間",
        workspaceDesc: "工作空間用於存放資料，後續可以在頂欄左上角的主選單中進行切換",
        notice: "⚠️ 請勿使用第三方同步盤同步資料，否則會導致執行異常和資料損壞",
        open: "開啟",
        selectBtn: "選擇",
        lang: "🌐 外觀語言",
        langDesc: "使用者介面語言，後續可以在 <kbd>設定</kbd> - <kbd>外觀</kbd> 中進行切換",
        feedback: "求助回饋建議",
        community: "使用者社群匯總",
        download: "下載最新版",
        feedbackUrl: "https://ld246.com/article/1649901726096",
        communityUrl: "https://ld246.com/article/1640266171309",
        downloadUrl: "https://b3log.org/siyuan/download.html",
        msgPartitionRoot: "⚠️ 請勿在分區根路徑上建立工作空間，請新增一個資料夾作為工作空間",
        msgNotEmpty: "⚠️ 該資料夾包含了其他檔案，請新增一個資料夾作為工作空間",
        msgICloud: "⚠️ 該資料夾位於 iCloud 同步路徑下，請更換其他路徑",
        msgCloudDrive: "⚠️ 資料夾路徑不能包含 onedrive、dropbox、google drive、pcloud、nutstore、baidunetdisk、weiyun、堅果雲、百度網盤和騰訊微雲等字樣，請更換其他路徑",
        msgConfirm: "⚠️ 請確認沒有將工作空間設定在第三方同步盤路徑下，否則會造成資料損壞（iCloud/OneDrive/Dropbox/Google Drive/堅果雲/百度網盤/騰訊微雲等），是否繼續？",
    },
    "en": {
        title: "SiYuan",
        crashTip: "⚠️ A renderer process previously exited unexpectedly. This may be related to plugins, code snippets, or a custom theme and icon. Starting in safe mode is recommended. Safe mode disables all plugins and code snippets and switches to the default theme and icon. Related content is not deleted, but these settings must be restored manually after startup.",
        safeModeBtn: "🛡️ Start in safe mode",
        normalBtn: "Start normally",
        slogan: "Refactor your thinking",
        wsTitle: "Workspaces",
        missingTip: "⚠️ The last opened workspace path could not be found",
        emptyHint: "No available workspaces, please select a new workspace path",
        selectPath: "🗂️ Select a new workspace path",
        selectPathDesc: "The workspace is used to store data, which can be switched later in the top bar menu later",
        workspace: "🗂️ Workspace",
        workspaceDesc: "The workspace is used to store data, which can be switched later in the top bar menu later",
        notice: "⚠️ Do not use a third-party sync disk to sync data, otherwise it will cause abnormal operation and data damage",
        open: "Open",
        selectBtn: "Select",
        lang: "🌐 Language",
        langDesc: "User interface language, which can be switched later in <kbd>Settings</kbd> - <kbd>Appearance</kbd>",
        feedback: "Support and Feedback",
        community: "User community summary",
        download: "Download",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Do not create the workspace in the partition root path, please create a new folder as the workspace",
        msgNotEmpty: "⚠️ This folder contains other files, please create a new folder as the workspace",
        msgICloud: "⚠️ This folder is under the iCloud sync path, please change another path",
        msgCloudDrive: "⚠️ The folder path can not contain onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, etc., please change another path",
        msgConfirm: "⚠️ Please confirm that the workspace is not set under the path of a third-party sync disk, otherwise it will cause data damage (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, etc.), continue?",
    },
    "ar": {
        title: "SiYuan",
        crashTip: "⚠️ تم اكتشاف خروج غير متوقع سابق لعملية العارض، وقد يكون مرتبطًا بالمكونات الإضافية أو مقتطفات التعليمات البرمجية أو السمات والأيقونات المخصصة. نوصي بالبدء في الوضع الآمن. يعطّل الوضع الآمن جميع المكونات الإضافية ومقتطفات التعليمات البرمجية ويستخدم السمة والأيقونة الافتراضيتين؛ لن يُحذف المحتوى ذو الصلة، ولكن يجب استعادة هذه الإعدادات يدويًا بعد بدء التشغيل.",
        safeModeBtn: "🛡️ البدء في الوضع الآمن",
        normalBtn: "البدء بشكل طبيعي",
        slogan: "أعد هيكلة تفكيرك",
        wsTitle: "مساحات العمل",
        missingTip: "⚠️ تعذر العثور على مسار مساحة العمل المفتوحة آخر مرة",
        emptyHint: "لا توجد مساحات عمل متاحة، يرجى تحديد مسار مساحة عمل جديد",
        selectPath: "🗂️ تحديد مسار مساحة عمل جديد",
        selectPathDesc: "تُستخدم مساحة العمل لتخزين البيانات، ويمكن تبديلها لاحقًا من القائمة الرئيسية في الزاوية العلوية اليسرى",
        workspace: "🗂️ مساحة العمل",
        workspaceDesc: "تُستخدم مساحة العمل لتخزين البيانات، ويمكن تبديلها لاحقًا من القائمة الرئيسية في الزاوية العلوية اليسرى",
        notice: "⚠️ لا تستخدم قرص مزامنة تابع لجهة خارجية لمزامنة البيانات، وإلا فقد يؤدي ذلك إلى تشغيل غير طبيعي وتلف البيانات",
        open: "فتح",
        selectBtn: "تحديد",
        lang: "🌐 اللغة",
        langDesc: "لغة واجهة المستخدم، يمكن تبديلها لاحقًا في <kbd>الإعدادات</kbd> - <kbd>المظهر</kbd>",
        feedback: "الدعم والملاحظات",
        community: "ملخص مجتمع المستخدمين",
        download: "تحميل",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ لا تنشئ مساحة العمل في المسار الجذري للقسم، يرجى إنشاء مجلد جديد كمساحة عمل",
        msgNotEmpty: "⚠️ يحتوي هذا المجلد على ملفات أخرى، يرجى إنشاء مجلد جديد كمساحة عمل",
        msgICloud: "⚠️ هذا المجلد ضمن مسار مزامنة iCloud، يرجى تغيير مسار آخر",
        msgCloudDrive: "⚠️ لا يمكن أن يحتوي مسار المجلد على onedrive أو dropbox أو google drive أو pcloud أو nutstore أو baidunetdisk أو weiyun وغيرها، يرجى تغيير مسار آخر",
        msgConfirm: "⚠️ يرجى تأكيد عدم تعيين مساحة العمل ضمن مسار قرص مزامنة تابع لجهة خارجية، وإلا فقد يتسبب ذلك في تلف البيانات (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun وغيرها)، هل تريد المتابعة؟",
    },
    "de": {
        title: "SiYuan",
        crashTip: "⚠️ Ein Renderer-Prozess wurde zuvor unerwartet beendet. Dies kann mit Plugins, Code-Snippets oder benutzerdefinierten Designs und Symbolen zusammenhängen. Es wird empfohlen, im abgesicherten Modus zu starten. Dieser deaktiviert alle Plugins und Code-Snippets und wechselt zum Standarddesign und -symbol. Die zugehörigen Inhalte werden nicht gelöscht, diese Einstellungen müssen nach dem Start jedoch manuell wiederhergestellt werden.",
        safeModeBtn: "🛡️ Im abgesicherten Modus starten",
        normalBtn: "Normal starten",
        slogan: "Strukturiere dein Denken",
        wsTitle: "Arbeitsbereiche",
        missingTip: "⚠️ Der zuletzt geöffnete Arbeitsbereich-Pfad konnte nicht gefunden werden",
        emptyHint: "Keine verfügbaren Arbeitsbereiche, bitte einen neuen Arbeitsbereich-Pfad auswählen",
        selectPath: "🗂️ Neuen Arbeitsbereich-Pfad auswählen",
        selectPathDesc: "Der Arbeitsbereich dient zum Speichern von Daten und kann später im Hauptmenü der oberen Leiste gewechselt werden",
        workspace: "🗂️ Arbeitsbereich",
        workspaceDesc: "Der Arbeitsbereich dient zum Speichern von Daten und kann später im Hauptmenü der oberen Leiste gewechselt werden",
        notice: "⚠️ Verwende keine Sync-Festplatte eines Drittanbieters zum Synchronisieren von Daten, da dies zu Fehlfunktionen und Datenverlust führen kann",
        open: "Öffnen",
        selectBtn: "Auswählen",
        lang: "🌐 Sprache",
        langDesc: "Sprache der Benutzeroberfläche, die später in <kbd>Einstellungen</kbd> - <kbd>Erscheinungsbild</kbd> gewechselt werden kann",
        feedback: "Support und Feedback",
        community: "Zusammenfassung der Benutzergemeinschaft",
        download: "Herunterladen",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Erstellen Sie den Arbeitsbereich nicht im Stammverzeichnis der Partition, erstellen Sie bitte einen neuen Ordner als Arbeitsbereich",
        msgNotEmpty: "⚠️ Dieser Ordner enthält andere Dateien, erstellen Sie bitte einen neuen Ordner als Arbeitsbereich",
        msgICloud: "⚠️ Dieser Ordner befindet sich unter dem iCloud-Synchronisierungspfad, bitte einen anderen Pfad wählen",
        msgCloudDrive: "⚠️ Der Ordnerpfad darf nicht onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun usw. enthalten, bitte einen anderen Pfad wählen",
        msgConfirm: "⚠️ Bitte bestätigen Sie, dass der Arbeitsbereich nicht unter dem Pfad einer Sync-Festplatte eines Drittanbieters eingerichtet ist, da dies zu Datenbeschädigung führen kann (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun usw.), fortfahren?",
    },
    "es": {
        title: "SiYuan",
        crashTip: "⚠️ Se detectó que un proceso de renderizado se cerró inesperadamente. Esto puede estar relacionado con complementos, fragmentos de código o temas e iconos personalizados. Se recomienda iniciar en modo seguro. El modo seguro desactiva todos los complementos y fragmentos de código y cambia al tema y al icono predeterminados. El contenido relacionado no se eliminará, pero estas opciones deberán restaurarse manualmente después del inicio.",
        safeModeBtn: "🛡️ Iniciar en modo seguro",
        normalBtn: "Iniciar normalmente",
        slogan: "Reestructura tu pensamiento",
        wsTitle: "Espacios de trabajo",
        missingTip: "⚠️ No se pudo encontrar la ruta del último espacio de trabajo abierto",
        emptyHint: "No hay espacios de trabajo disponibles, seleccione una nueva ruta de espacio de trabajo",
        selectPath: "🗂️ Seleccionar una nueva ruta de espacio de trabajo",
        selectPathDesc: "El espacio de trabajo se utiliza para almacenar datos, que se pueden cambiar más tarde en el menú principal de la barra superior",
        workspace: "🗂️ Espacio de trabajo",
        workspaceDesc: "El espacio de trabajo se utiliza para almacenar datos, que se pueden cambiar más tarde en el menú principal de la barra superior",
        notice: "⚠️ No utilice un disco de sincronización de terceros para sincronizar datos, de lo contrario puede causar un funcionamiento anormal y daño en los datos",
        open: "Abrir",
        selectBtn: "Seleccionar",
        lang: "🌐 Idioma",
        langDesc: "Idioma de la interfaz de usuario, que se puede cambiar más tarde en <kbd>Ajustes</kbd> - <kbd>Apariencia</kbd>",
        feedback: "Soporte y comentarios",
        community: "Resumen de la comunidad de usuarios",
        download: "Descargar",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ No cree el espacio de trabajo en la ruta raíz de la partición, cree una nueva carpeta como espacio de trabajo",
        msgNotEmpty: "⚠️ Esta carpeta contiene otros archivos, cree una nueva carpeta como espacio de trabajo",
        msgICloud: "⚠️ Esta carpeta está bajo la ruta de sincronización de iCloud, cambie a otra ruta",
        msgCloudDrive: "⚠️ La ruta de la carpeta no puede contener onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, etc., cambie a otra ruta",
        msgConfirm: "⚠️ Confirme que el espacio de trabajo no está configurado bajo la ruta de un disco de sincronización de terceros, de lo contrario causará daños en los datos (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, etc.), ¿continuar?",
    },
    "fr": {
        title: "SiYuan",
        crashTip: "⚠️ Un processus de rendu s'est précédemment arrêté de manière inattendue. Cela peut être lié aux extensions, aux extraits de code ou aux thèmes et icônes personnalisés. Il est recommandé de démarrer en mode sans échec. Celui-ci désactive toutes les extensions et tous les extraits de code, puis utilise le thème et l'icône par défaut. Le contenu associé ne sera pas supprimé, mais ces réglages devront être restaurés manuellement après le démarrage.",
        safeModeBtn: "🛡️ Démarrer en mode sans échec",
        normalBtn: "Démarrer normalement",
        slogan: "Restructurez votre pensée",
        wsTitle: "Espaces de travail",
        missingTip: "⚠️ Le chemin du dernier espace de travail ouvert est introuvable",
        emptyHint: "Aucun espace de travail disponible, veuillez sélectionner un nouveau chemin d'espace de travail",
        selectPath: "🗂️ Sélectionner un nouveau chemin d'espace de travail",
        selectPathDesc: "L'espace de travail est utilisé pour stocker des données, il peut être changé plus tard dans le menu principal de la barre supérieure",
        workspace: "🗂️ Espace de travail",
        workspaceDesc: "L'espace de travail est utilisé pour stocker des données, il peut être changé plus tard dans le menu principal de la barre supérieure",
        notice: "⚠️ N'utilisez pas un disque de synchronisation tiers pour synchroniser les données, sinon cela entraînera un fonctionnement anormal et des dommages aux données",
        open: "Ouvrir",
        selectBtn: "Sélectionner",
        lang: "🌐 Langue",
        langDesc: "Langue de l'interface utilisateur, pouvant être modifiée ultérieurement dans <kbd>Paramètres</kbd> - <kbd>Apparence</kbd>",
        feedback: "Assistance et commentaires",
        community: "Résumé de la communauté d'utilisateurs",
        download: "Télécharger",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Ne créez pas l'espace de travail dans le chemin racine de la partition, veuillez créer un nouveau dossier comme espace de travail",
        msgNotEmpty: "⚠️ Ce dossier contient d'autres fichiers, veuillez créer un nouveau dossier comme espace de travail",
        msgICloud: "⚠️ Ce dossier se trouve sous le chemin de synchronisation iCloud, veuillez changer de chemin",
        msgCloudDrive: "⚠️ Le chemin du dossier ne peut pas contenir onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, etc., veuillez changer de chemin",
        msgConfirm: "⚠️ Veuillez confirmer que l'espace de travail n'est pas défini sous le chemin d'un disque de synchronisation tiers, sinon cela causera des dommages aux données (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, etc.), continuer ?",
    },
    "he": {
        title: "SiYuan",
        crashTip: "⚠️ זוהה שתהליך עיבוד הסתיים בעבר באופן בלתי צפוי. ייתכן שהדבר קשור לתוספים, לקטעי קוד או לערכת נושא וסמלים מותאמים אישית. מומלץ להפעיל במצב בטוח. מצב בטוח משבית את כל התוספים וקטעי הקוד ועובר לערכת הנושא ולסמל שברירת המחדל. התוכן הקשור לא יימחק, אך יש לשחזר הגדרות אלה ידנית לאחר ההפעלה.",
        safeModeBtn: "🛡️ הפעלה במצב בטוח",
        normalBtn: "הפעלה רגילה",
        slogan: "ארגן מחדש את החשיבה שלך",
        wsTitle: "סביבות עבודה",
        missingTip: "⚠️ לא ניתן היה למצוא את הנתיב של סביבת העבודה האחרונה שנפתחה",
        emptyHint: "אין סביבות עבודה זמינות, נא לבחור נתיב סביבת עבודה חדש",
        selectPath: "🗂️ בחירת נתיב סביבת עבודה חדש",
        selectPathDesc: "סביבת העבודה משמשת לאחסון נתונים, ניתן להחליף אותה מאוחר יותר בתפריט הראשי בסרגל העליון",
        workspace: "🗂️ סביבת עבודה",
        workspaceDesc: "סביבת העבודה משמשת לאחסון נתונים, ניתן להחליף אותה מאוחר יותר בתפריט הראשי בסרגל העליון",
        notice: "⚠️ אל תשתמש בדיסק סנכרון של צד שלישי לסנכרון נתונים, אחרת זה עלול לגרום לפעולה לא תקינה ולנזק לנתונים",
        open: "פתיחה",
        selectBtn: "בחירה",
        lang: "🌐 שפה",
        langDesc: "שפת ממשק המשתמש, ניתן להחליף מאוחר יותר ב-<kbd>הגדרות</kbd> - <kbd>מראה</kbd>",
        feedback: "תמיכה ומשוב",
        community: "סיכום קהילת המשתמשים",
        download: "הורדה",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ אל תיצור את סביבת העבודה בנתיב השורש של המחיצה, נא ליצור תיקייה חדשה כסביבת עבודה",
        msgNotEmpty: "⚠️ תיקייה זו מכילה קבצים אחרים, נא ליצור תיקייה חדשה כסביבת עבודה",
        msgICloud: "⚠️ תיקייה זו נמצאת תחת נתיב סנכרון iCloud, נא לשנות נתיב אחר",
        msgCloudDrive: "⚠️ נתיב התיקייה אינו יכול להכיל onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun וכו', נא לשנות נתיב אחר",
        msgConfirm: "⚠️ נא לאשר שסביבת העבודה אינה מוגדרת תחת נתיב של דיסק סנכרון של צד שלישי, אחרת זה יגרום לנזק לנתונים (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun וכו'), להמשיך?",
    },
    "hi": {
        title: "SiYuan",
        crashTip: "⚠️ एक रेंडरर प्रक्रिया के पहले अप्रत्याशित रूप से बंद होने का पता चला। यह प्लगइन, कोड स्निपेट या कस्टम थीम और आइकन से संबंधित हो सकता है। सुरक्षित मोड में प्रारंभ करने की सलाह दी जाती है। सुरक्षित मोड सभी प्लगइन और कोड स्निपेट को अक्षम कर देता है और डिफ़ॉल्ट थीम और आइकन पर स्विच करता है। संबंधित सामग्री हटाई नहीं जाएगी, लेकिन शुरू होने के बाद इन सेटिंग्स को मैन्युअल रूप से पुनर्स्थापित करना होगा।",
        safeModeBtn: "🛡️ सुरक्षित मोड में प्रारंभ करें",
        normalBtn: "सामान्य रूप से प्रारंभ करें",
        slogan: "अपनी सोच को पुनर्गठित करें",
        wsTitle: "वर्कस्पेस",
        missingTip: "⚠️ अंतिम बार खोला गया वर्कस्पेस पथ नहीं मिल सका",
        emptyHint: "कोई उपलब्ध वर्कस्पेस नहीं, कृपया एक नया वर्कस्पेस पथ चुनें",
        selectPath: "🗂️ एक नया वर्कस्पेस पथ चुनें",
        selectPathDesc: "वर्कस्पेस का उपयोग डेटा संग्रहीत करने के लिए किया जाता है, जिसे बाद में शीर्ष बार मेन्यू में बदला जा सकता है",
        workspace: "🗂️ वर्कस्पेस",
        workspaceDesc: "वर्कस्पेस का उपयोग डेटा संग्रहीत करने के लिए किया जाता है, जिसे बाद में शीर्ष बार मेन्यू में बदला जा सकता है",
        notice: "⚠️ डेटा को सिंक करने के लिए तृतीय-पक्ष सिंक डिस्क का उपयोग न करें, अन्यथा यह असामान्य संचालन और डेटा क्षति का कारण बनेगा",
        open: "खोलें",
        selectBtn: "चुनें",
        lang: "🌐 भाषा",
        langDesc: "उपयोगकर्ता इंटरफ़ेस भाषा, जिसे बाद में <kbd>सेटिंग्स</kbd> - <kbd>रूप</kbd> में बदला जा सकता है",
        feedback: "सहायता और प्रतिक्रिया",
        community: "उपयोगकर्ता समुदाय सारांश",
        download: "डाउनलोड",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ वर्कस्पेस को पार्टीशन रूट पथ में न बनाएं, कृपया वर्कस्पेस के रूप में एक नया फ़ोल्डर बनाएं",
        msgNotEmpty: "⚠️ इस फ़ोल्डर में अन्य फ़ाइलें हैं, कृपया वर्कस्पेस के रूप में एक नया फ़ोल्डर बनाएं",
        msgICloud: "⚠️ यह फ़ोल्डर iCloud सिंक पथ के अंतर्गत है, कृपया कोई अन्य पथ बदलें",
        msgCloudDrive: "⚠️ फ़ोल्डर पथ में onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun आदि नहीं हो सकते, कृपया कोई अन्य पथ बदलें",
        msgConfirm: "⚠️ कृपया पुष्टि करें कि वर्कस्पेस किसी तृतीय-पक्ष सिंक डिस्क के पथ के अंतर्गत सेट नहीं है, अन्यथा यह डेटा क्षति का कारण बनेगा (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun आदि), जारी रखें?",
    },
    "id": {
        title: "SiYuan",
        crashTip: "⚠️ Proses renderer terdeteksi pernah berhenti secara tidak terduga. Hal ini mungkin terkait dengan plugin, cuplikan kode, atau tema dan ikon kustom. Disarankan untuk memulai dalam mode aman. Mode aman menonaktifkan semua plugin dan cuplikan kode serta beralih ke tema dan ikon default. Konten terkait tidak akan dihapus, tetapi pengaturan ini harus dipulihkan secara manual setelah aplikasi dimulai.",
        safeModeBtn: "🛡️ Mulai dalam mode aman",
        normalBtn: "Mulai secara normal",
        slogan: "Restruktur pemikiran Anda",
        wsTitle: "Ruang Kerja",
        missingTip: "⚠️ Jalur ruang kerja yang terakhir dibuka tidak dapat ditemukan",
        emptyHint: "Tidak ada ruang kerja yang tersedia, silakan pilih jalur ruang kerja baru",
        selectPath: "🗂️ Pilih jalur ruang kerja baru",
        selectPathDesc: "Ruang kerja digunakan untuk menyimpan data, yang dapat dialihkan nanti di menu bilah atas",
        workspace: "🗂️ Ruang Kerja",
        workspaceDesc: "Ruang kerja digunakan untuk menyimpan data, yang dapat dialihkan nanti di menu bilah atas",
        notice: "⚠️ Jangan gunakan disk sinkronisasi pihak ketiga untuk menyinkronkan data, jika tidak akan menyebabkan operasi abnormal dan kerusakan data",
        open: "Buka",
        selectBtn: "Pilih",
        lang: "🌐 Bahasa",
        langDesc: "Bahasa antarmuka pengguna, yang dapat dialihkan nanti di <kbd>Pengaturan</kbd> - <kbd>Tampilan</kbd>",
        feedback: "Dukungan dan Umpan Balik",
        community: "Ringkasan komunitas pengguna",
        download: "Unduh",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Jangan membuat ruang kerja di jalur root partisi, silakan buat folder baru sebagai ruang kerja",
        msgNotEmpty: "⚠️ Folder ini berisi file lain, silakan buat folder baru sebagai ruang kerja",
        msgICloud: "⚠️ Folder ini berada di bawah jalur sinkronisasi iCloud, silakan ganti jalur lain",
        msgCloudDrive: "⚠️ Jalur folder tidak boleh berisi onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, dll., silakan ganti jalur lain",
        msgConfirm: "⚠️ Harap konfirmasi bahwa ruang kerja tidak diatur di bawah jalur disk sinkronisasi pihak ketiga, jika tidak itu akan menyebabkan kerusakan data (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, dll.), lanjutkan?",
    },
    "it": {
        title: "SiYuan",
        crashTip: "⚠️ È stato rilevato che un processo di rendering si è chiuso inaspettatamente. Ciò potrebbe essere correlato a plugin, snippet di codice o temi e icone personalizzati. Si consiglia di avviare in modalità sicura. La modalità sicura disabilita tutti i plugin e gli snippet di codice e passa al tema e all'icona predefiniti. I contenuti correlati non verranno eliminati, ma queste impostazioni dovranno essere ripristinate manualmente dopo l'avvio.",
        safeModeBtn: "🛡️ Avvia in modalità sicura",
        normalBtn: "Avvia normalmente",
        slogan: "Ristruttura il tuo pensiero",
        wsTitle: "Spazi di lavoro",
        missingTip: "⚠️ Impossibile trovare il percorso dell'ultimo spazio di lavoro aperto",
        emptyHint: "Nessuno spazio di lavoro disponibile, selezionare un nuovo percorso dello spazio di lavoro",
        selectPath: "🗂️ Seleziona un nuovo percorso dello spazio di lavoro",
        selectPathDesc: "Lo spazio di lavoro viene utilizzato per memorizzare i dati, che può essere cambiato successivamente nel menu principale della barra superiore",
        workspace: "🗂️ Spazio di lavoro",
        workspaceDesc: "Lo spazio di lavoro viene utilizzato per memorizzare i dati, che può essere cambiato successivamente nel menu principale della barra superiore",
        notice: "⚠️ Non utilizzare un disco di sincronizzazione di terze parti per sincronizzare i dati, altrimenti causerà malfunzionamenti e danni ai dati",
        open: "Apri",
        selectBtn: "Seleziona",
        lang: "🌐 Lingua",
        langDesc: "Lingua dell'interfaccia utente, che può essere cambiata successivamente in <kbd>Impostazioni</kbd> - <kbd>Aspetto</kbd>",
        feedback: "Supporto e feedback",
        community: "Riepilogo della community degli utenti",
        download: "Scarica",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Non creare lo spazio di lavoro nel percorso root della partizione, crea una nuova cartella come spazio di lavoro",
        msgNotEmpty: "⚠️ Questa cartella contiene altri file, crea una nuova cartella come spazio di lavoro",
        msgICloud: "⚠️ Questa cartella si trova nel percorso di sincronizzazione iCloud, si prega di cambiare un altro percorso",
        msgCloudDrive: "⚠️ Il percorso della cartella non può contenere onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, ecc., si prega di cambiare un altro percorso",
        msgConfirm: "⚠️ Si prega di confermare che lo spazio di lavoro non è impostato nel percorso di un disco di sincronizzazione di terze parti, altrimenti causerà danni ai dati (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, ecc.), continuare?",
    },
    "ja": {
        title: "SiYuan",
        crashTip: "⚠️ レンダラープロセスが以前予期せず終了したことが検出されました。プラグイン、コードスニペット、またはカスタムテーマとアイコンが関係している可能性があります。セーフモードでの起動をお勧めします。セーフモードでは、すべてのプラグインとコードスニペットが無効になり、デフォルトのテーマとアイコンに切り替わります。関連コンテンツは削除されませんが、起動後にこれらの設定を手動で復元する必要があります。",
        safeModeBtn: "🛡️ セーフモードで起動",
        normalBtn: "通常起動",
        slogan: "思考を再構築する",
        wsTitle: "ワークスペース",
        missingTip: "⚠️ 最後に開いたワークスペースのパスが見つかりませんでした",
        emptyHint: "利用可能なワークスペースがありません。新しいワークスペースのパスを選択してください",
        selectPath: "🗂️ 新しいワークスペースのパスを選択",
        selectPathDesc: "ワークスペースはデータの保存に使用されます。後でトップバーのメインメニューで切り替えることができます",
        workspace: "🗂️ ワークスペース",
        workspaceDesc: "ワークスペースはデータの保存に使用されます。後でトップバーのメインメニューで切り替えることができます",
        notice: "⚠️ サードパーティの同期ディスクを使用してデータを同期しないでください。そうしないと、異常な動作やデータの破損が発生する可能性があります",
        open: "開く",
        selectBtn: "選択",
        lang: "🌐 言語",
        langDesc: "ユーザーインターフェースの言語です。後で<kbd>設定</kbd> - <kbd>外観</kbd>で切り替えることができます",
        feedback: "サポートとフィードバック",
        community: "ユーザーコミュニティの概要",
        download: "ダウンロード",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ パーティションのルートパスにワークスペースを作成しないでください。ワークスペースとして新しいフォルダを作成してください",
        msgNotEmpty: "⚠️ このフォルダには他のファイルが含まれています。ワークスペースとして新しいフォルダを作成してください",
        msgICloud: "⚠️ このフォルダはiCloud同期パスの下にあります。別のパスに変更してください",
        msgCloudDrive: "⚠️ フォルダパスにonedrive、dropbox、google drive、pcloud、nutstore、baidunetdisk、weiyunなどは含められません。別のパスに変更してください",
        msgConfirm: "⚠️ ワークスペースがサードパーティの同期ディスクのパスの下に設定されていないことを確認してください。そうでないとデータの破損が発生する可能性があります（iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyunなど）。続行しますか？",
    },
    "ko": {
        title: "SiYuan",
        crashTip: "⚠️ 렌더러 프로세스가 이전에 예기치 않게 종료된 것이 감지되었습니다. 플러그인, 코드 스니펫 또는 사용자 지정 테마와 아이콘과 관련이 있을 수 있습니다. 안전 모드로 시작하는 것이 권장됩니다. 안전 모드에서는 모든 플러그인과 코드 스니펫이 비활성화되고 기본 테마와 아이콘으로 전환됩니다. 관련 콘텐츠는 삭제되지 않지만 시작 후 이 설정을 수동으로 복원해야 합니다.",
        safeModeBtn: "🛡️ 안전 모드로 시작",
        normalBtn: "정상적으로 시작",
        slogan: "당신의 사고를 재구성하세요",
        wsTitle: "워크스페이스",
        missingTip: "⚠️ 마지막으로 열린 워크스페이스 경로를 찾을 수 없습니다",
        emptyHint: "사용 가능한 워크스페이스가 없습니다. 새 워크스페이스 경로를 선택하세요",
        selectPath: "🗂️ 새 워크스페이스 경로 선택",
        selectPathDesc: "워크스페이스는 데이터를 저장하는 데 사용되며, 나중에 상단 표시줄 메뉴에서 전환할 수 있습니다",
        workspace: "🗂️ 워크스페이스",
        workspaceDesc: "워크스페이스는 데이터를 저장하는 데 사용되며, 나중에 상단 표시줄 메뉴에서 전환할 수 있습니다",
        notice: "⚠️ 타사 동기화 디스크를 사용하여 데이터를 동기화하지 마세요. 그렇지 않으면 비정상적인 작동과 데이터 손상이 발생할 수 있습니다",
        open: "열기",
        selectBtn: "선택",
        lang: "🌐 언어",
        langDesc: "사용자 인터페이스 언어이며, 나중에 <kbd>설정</kbd> - <kbd>외관</kbd>에서 전환할 수 있습니다",
        feedback: "지원 및 피드백",
        community: "사용자 커뮤니티 요약",
        download: "다운로드",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ 파티션 루트 경로에 워크스페이스를 만들지 마세요. 워크스페이스로 새 폴더를 만드세요",
        msgNotEmpty: "⚠️ 이 폴더에는 다른 파일이 포함되어 있습니다. 워크스페이스로 새 폴더를 만드세요",
        msgICloud: "⚠️ 이 폴더는 iCloud 동기화 경로 아래에 있습니다. 다른 경로로 변경하세요",
        msgCloudDrive: "⚠️ 폴더 경로에 onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun 등이 포함될 수 없습니다. 다른 경로로 변경하세요",
        msgConfirm: "⚠️ 워크스페이스가 타사 동기화 디스크 경로 아래에 설정되지 않았는지 확인하세요. 그렇지 않으면 데이터 손상이 발생합니다(iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun 등). 계속하시겠습니까?",
    },
    "nl": {
        title: "SiYuan",
        crashTip: "⚠️ Er is gedetecteerd dat een renderer-proces eerder onverwacht is afgesloten. Dit kan verband houden met plug-ins, codefragmenten of een aangepast thema en pictogram. Het wordt aanbevolen om in de veilige modus te starten. De veilige modus schakelt alle plug-ins en codefragmenten uit en gebruikt het standaardthema en -pictogram. Gerelateerde inhoud wordt niet verwijderd, maar deze instellingen moeten na het opstarten handmatig worden hersteld.",
        safeModeBtn: "🛡️ Start in veilige modus",
        normalBtn: "Normaal starten",
        slogan: "Herstructureer je denken",
        wsTitle: "Werkruimten",
        missingTip: "⚠️ Het laatst geopende werkruimtepad kon niet worden gevonden",
        emptyHint: "Geen beschikbare werkruimten, selecteer een nieuw werkruimtepad",
        selectPath: "🗂️ Selecteer een nieuw werkruimtepad",
        selectPathDesc: "De werkruimte wordt gebruikt om gegevens op te slaan, die later kan worden gewisseld in het hoofdmenu van de bovenste balk",
        workspace: "🗂️ Werkruimte",
        workspaceDesc: "De werkruimte wordt gebruikt om gegevens op te slaan, die later kan worden gewisseld in het hoofdmenu van de bovenste balk",
        notice: "⚠️ Gebruik geen synchronisatieschijf van derden om gegevens te synchroniseren, anders leidt dit tot abnormale werking en gegevensbeschadiging",
        open: "Openen",
        selectBtn: "Selecteren",
        lang: "🌐 Taal",
        langDesc: "Taal van de gebruikersinterface, die later kan worden gewisseld in <kbd>Instellingen</kbd> - <kbd>Weergave</kbd>",
        feedback: "Ondersteuning en feedback",
        community: "Overzicht van gebruikersgemeenschap",
        download: "Downloaden",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Maak de werkruimte niet in het hoofdpad van de partitie, maak een nieuwe map als werkruimte",
        msgNotEmpty: "⚠️ Deze map bevat andere bestanden, maak een nieuwe map als werkruimte",
        msgICloud: "⚠️ Deze map bevindt zich onder het iCloud-synchronisatiepad, wijzig een ander pad",
        msgCloudDrive: "⚠️ Het mappad kan geen onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, etc. bevatten, wijzig een ander pad",
        msgConfirm: "⚠️ Bevestig dat de werkruimte niet is ingesteld onder het pad van een synchronisatieschijf van derden, anders veroorzaakt dit gegevensbeschadiging (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, etc.), doorgaan?",
    },
    "pl": {
        title: "SiYuan",
        crashTip: "⚠️ Wykryto, że proces renderowania zakończył się wcześniej w nieoczekiwany sposób. Może to mieć związek z wtyczkami, fragmentami kodu albo niestandardowym motywem i ikoną. Zaleca się uruchomienie w trybie awaryjnym. Tryb awaryjny wyłącza wszystkie wtyczki i fragmenty kodu oraz przełącza na domyślny motyw i ikonę. Powiązana zawartość nie zostanie usunięta, ale po uruchomieniu te ustawienia trzeba przywrócić ręcznie.",
        safeModeBtn: "🛡️ Uruchom w trybie awaryjnym",
        normalBtn: "Uruchom normalnie",
        slogan: "Zrestrukturyzuj swoje myślenie",
        wsTitle: "Obszary robocze",
        missingTip: "⚠️ Nie można znaleźć ścieżki ostatnio otwartego obszaru roboczego",
        emptyHint: "Brak dostępnych obszarów roboczych, wybierz nową ścieżkę obszaru roboczego",
        selectPath: "🗂️ Wybierz nową ścieżkę obszaru roboczego",
        selectPathDesc: "Obszar roboczy służy do przechowywania danych, które można później przełączyć w głównym menu górnego paska",
        workspace: "🗂️ Obszar roboczy",
        workspaceDesc: "Obszar roboczy służy do przechowywania danych, które można później przełączyć w głównym menu górnego paska",
        notice: "⚠️ Nie używaj dysku synchronizacji innej firmy do synchronizacji danych, w przeciwnym razie doprowadzi to do nieprawidłowego działania i uszkodzenia danych",
        open: "Otwórz",
        selectBtn: "Wybierz",
        lang: "🌐 Język",
        langDesc: "Język interfejsu użytkownika, który można później przełączyć w <kbd>Ustawieniach</kbd> - <kbd>Wygląd</kbd>",
        feedback: "Wsparcie i opinie",
        community: "Podsumowanie społeczności użytkowników",
        download: "Pobierz",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Nie twórz obszaru roboczego w ścieżce głównej partycji, utwórz nowy folder jako obszar roboczy",
        msgNotEmpty: "⚠️ Ten folder zawiera inne pliki, utwórz nowy folder jako obszar roboczy",
        msgICloud: "⚠️ Ten folder znajduje się w ścieżce synchronizacji iCloud, zmień inną ścieżkę",
        msgCloudDrive: "⚠️ Ścieżka folderu nie może zawierać onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun itd., zmień inną ścieżkę",
        msgConfirm: "⚠️ Potwierdź, że obszar roboczy nie jest ustawiony w ścieżce dysku synchronizacji innej firmy, w przeciwnym razie spowoduje to uszkodzenie danych (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun itd.), kontynuować?",
    },
    "pt-BR": {
        title: "SiYuan",
        crashTip: "⚠️ Foi detectado que um processo de renderização foi encerrado inesperadamente anteriormente. Isso pode estar relacionado a plug-ins, trechos de código ou temas e ícones personalizados. Recomenda-se iniciar no modo de segurança. O modo de segurança desativa todos os plug-ins e trechos de código e muda para o tema e o ícone padrão. O conteúdo relacionado não será excluído, mas essas configurações deverão ser restauradas manualmente após a inicialização.",
        safeModeBtn: "🛡️ Iniciar no modo de segurança",
        normalBtn: "Iniciar normalmente",
        slogan: "Restruture seu pensamento",
        wsTitle: "Espaços de trabalho",
        missingTip: "⚠️ O caminho do último espaço de trabalho aberto não pôde ser encontrado",
        emptyHint: "Nenhum espaço de trabalho disponível, selecione um novo caminho de espaço de trabalho",
        selectPath: "🗂️ Selecionar um novo caminho de espaço de trabalho",
        selectPathDesc: "O espaço de trabalho é usado para armazenar dados, que pode ser alterado posteriormente no menu principal da barra superior",
        workspace: "🗂️ Espaço de trabalho",
        workspaceDesc: "O espaço de trabalho é usado para armazenar dados, que pode ser alterado posteriormente no menu principal da barra superior",
        notice: "⚠️ Não use um disco de sincronização de terceiros para sincronizar dados, caso contrário, causará operação anormal e danos aos dados",
        open: "Abrir",
        selectBtn: "Selecionar",
        lang: "🌐 Idioma",
        langDesc: "Idioma da interface do usuário, que pode ser alterado posteriormente em <kbd>Configurações</kbd> - <kbd>Aparência</kbd>",
        feedback: "Suporte e Feedback",
        community: "Resumo da comunidade de usuários",
        download: "Baixar",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Não crie o espaço de trabalho no caminho raiz da partição, crie uma nova pasta como espaço de trabalho",
        msgNotEmpty: "⚠️ Esta pasta contém outros arquivos, crie uma nova pasta como espaço de trabalho",
        msgICloud: "⚠️ Esta pasta está sob o caminho de sincronização do iCloud, altere para outro caminho",
        msgCloudDrive: "⚠️ O caminho da pasta não pode conter onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun, etc., altere para outro caminho",
        msgConfirm: "⚠️ Confirme que o espaço de trabalho não está definido sob o caminho de um disco de sincronização de terceiros, caso contrário causará danos aos dados (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun, etc.), continuar?",
    },
    "ru": {
        title: "SiYuan",
        crashTip: "⚠️ Обнаружено, что процесс отрисовки ранее неожиданно завершился. Это может быть связано с плагинами, фрагментами кода или пользовательскими темами и значками. Рекомендуется запуск в безопасном режиме. Безопасный режим отключает все плагины и фрагменты кода, а также переключает на стандартные тему и значок. Связанные материалы не удаляются, но после запуска эти настройки нужно восстановить вручную.",
        safeModeBtn: "🛡️ Запустить в безопасном режиме",
        normalBtn: "Запустить в обычном режиме",
        slogan: "Реструктурируйте своё мышление",
        wsTitle: "Рабочие пространства",
        missingTip: "⚠️ Не удалось найти путь последнего открытого рабочего пространства",
        emptyHint: "Нет доступных рабочих пространств, выберите новый путь рабочего пространства",
        selectPath: "🗂️ Выберите новый путь рабочего пространства",
        selectPathDesc: "Рабочее пространство используется для хранения данных, его можно переключить позже в главном меню верхней панели",
        workspace: "🗂️ Рабочее пространство",
        workspaceDesc: "Рабочее пространство используется для хранения данных, его можно переключить позже в главном меню верхней панели",
        notice: "⚠️ Не используйте сторонний диск синхронизации для синхронизации данных, иначе это приведёт к неправильной работе и повреждению данных",
        open: "Открыть",
        selectBtn: "Выбрать",
        lang: "🌐 Язык",
        langDesc: "Язык интерфейса пользователя, который можно переключить позже в <kbd>Настройках</kbd> - <kbd>Внешний вид</kbd>",
        feedback: "Поддержка и обратная связь",
        community: "Сводка сообщества пользователей",
        download: "Скачать",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Не создавайте рабочее пространство в корневом пути раздела, создайте новую папку в качестве рабочего пространства",
        msgNotEmpty: "⚠️ Эта папка содержит другие файлы, создайте новую папку в качестве рабочего пространства",
        msgICloud: "⚠️ Эта папка находится по пути синхронизации iCloud, измените другой путь",
        msgCloudDrive: "⚠️ Путь к папке не может содержать onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun и т. д., измените другой путь",
        msgConfirm: "⚠️ Подтвердите, что рабочее пространство не настроено по пути стороннего диска синхронизации, иначе это приведёт к повреждению данных (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun и т. д.), продолжить?",
    },
    "sk": {
        title: "SiYuan",
        crashTip: "⚠️ Zistilo sa, že proces vykresľovania sa predtým neočakávane ukončil. Môže to súvisieť s doplnkami, úryvkami kódu alebo vlastnými motívmi a ikonami. Odporúča sa spustiť v núdzovom režime. Núdzový režim zakáže všetky doplnky a úryvky kódu a prepne na predvolený motív a ikonu. Súvisiaci obsah sa neodstráni, ale tieto nastavenia bude potrebné po spustení obnoviť manuálne.",
        safeModeBtn: "🛡️ Spustiť v núdzovom režime",
        normalBtn: "Spustiť normálne",
        slogan: "Reštrukturalizujte svoje myslenie",
        wsTitle: "Pracovné priestory",
        missingTip: "⚠️ Nepodarilo sa nájsť cestu k poslednému otvorenému pracovnému priestoru",
        emptyHint: "Žiadne dostupné pracovné priestory, vyberte novú cestu pracovného priestoru",
        selectPath: "🗂️ Vybrať novú cestu pracovného priestoru",
        selectPathDesc: "Pracovný priestor sa používa na ukladanie údajov, ktoré sa dá neskôr prepnúť v hlavnej ponuke hornej lišty",
        workspace: "🗂️ Pracovný priestor",
        workspaceDesc: "Pracovný priestor sa používa na ukladanie údajov, ktoré sa dá neskôr prepnúť v hlavnej ponuke hornej lišty",
        notice: "⚠️ Nepoužívajte synchronizačný disk tretej strany na synchronizáciu údajov, inak to spôsobí abnormálnu prevádzku a poškodenie údajov",
        open: "Otvoriť",
        selectBtn: "Vybrať",
        lang: "🌐 Jazyk",
        langDesc: "Jazyk používateľského rozhrania, ktorý možno neskôr prepnúť v <kbd>Nastaveniach</kbd> - <kbd>Vzhľad</kbd>",
        feedback: "Podpora a spätná väzba",
        community: "Súhrn komunity používateľov",
        download: "Stiahnuť",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Nevytvárajte pracovný priestor v koreňovej ceste oddielu, vytvorte nový priečinok ako pracovný priestor",
        msgNotEmpty: "⚠️ Tento priečinok obsahuje iné súbory, vytvorte nový priečinok ako pracovný priestor",
        msgICloud: "⚠️ Tento priečinok je pod cestou synchronizácie iCloud, zmeňte inú cestu",
        msgCloudDrive: "⚠️ Cesta k priečinku nemôže obsahovať onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun atď., zmeňte inú cestu",
        msgConfirm: "⚠️ Potvrďte, že pracovný priestor nie je nastavený pod cestou synchronizačného disku tretej strany, inak to spôsobí poškodenie údajov (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun atď.), pokračovať?",
    },
    "th": {
        title: "SiYuan",
        crashTip: "⚠️ ตรวจพบว่ากระบวนการเรนเดอร์เคยปิดตัวลงอย่างไม่คาดคิด ซึ่งอาจเกี่ยวข้องกับปลั๊กอิน สนิปเป็ตโค้ด หรือธีมและไอคอนที่กำหนดเอง ขอแนะนำให้เริ่มในโหมดปลอดภัย โหมดปลอดภัยจะปิดใช้งานปลั๊กอินและสนิปเป็ตโค้ดทั้งหมด พร้อมทั้งเปลี่ยนไปใช้ธีมและไอคอนเริ่มต้น เนื้อหาที่เกี่ยวข้องจะไม่ถูกลบ แต่ต้องคืนค่าการตั้งค่าเหล่านี้ด้วยตนเองหลังจากเริ่มต้นแล้ว",
        safeModeBtn: "🛡️ เริ่มในโหมดปลอดภัย",
        normalBtn: "เริ่มแบบปกติ",
        slogan: "ปรับโครงสร้างความคิดของคุณ",
        wsTitle: "พื้นที่ทำงาน",
        missingTip: "⚠️ ไม่พบเส้นทางพื้นที่ทำงานที่เปิดล่าสุด",
        emptyHint: "ไม่มีพื้นที่ทำงานที่พร้อมใช้งาน โปรดเลือกเส้นทางพื้นที่ทำงานใหม่",
        selectPath: "🗂️ เลือกเส้นทางพื้นที่ทำงานใหม่",
        selectPathDesc: "พื้นที่ทำงานใช้สำหรับจัดเก็บข้อมูล ซึ่งสามารถสลับได้ในภายหลังในเมนูหลักของแถบด้านบน",
        workspace: "🗂️ พื้นที่ทำงาน",
        workspaceDesc: "พื้นที่ทำงานใช้สำหรับจัดเก็บข้อมูล ซึ่งสามารถสลับได้ในภายหลังในเมนูหลักของแถบด้านบน",
        notice: "⚠️ อย่าใช้ดิสก์ซิงค์ของบุคคลที่สามในการซิงค์ข้อมูล มิฉะนั้นจะทำให้การทำงานผิดปกติและข้อมูลเสียหาย",
        open: "เปิด",
        selectBtn: "เลือก",
        lang: "🌐 ภาษา",
        langDesc: "ภาษาของอินเทอร์เฟซผู้ใช้ ซึ่งสามารถสลับได้ในภายหลังใน <kbd>การตั้งค่า</kbd> - <kbd>ลักษณะ</kbd>",
        feedback: "การสนับสนุนและข้อเสนอแนะ",
        community: "สรุปชุมชนผู้ใช้",
        download: "ดาวน์โหลด",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ อย่าสร้างพื้นที่ทำงานในเส้นทางรูทของพาร์ติชัน โปรดสร้างโฟลเดอร์ใหม่เป็นพื้นที่ทำงาน",
        msgNotEmpty: "⚠️ โฟลเดอร์นี้มีไฟล์อื่น ๆ โปรดสร้างโฟลเดอร์ใหม่เป็นพื้นที่ทำงาน",
        msgICloud: "⚠️ โฟลเดอร์นี้อยู่ภายใต้เส้นทางซิงค์ iCloud โปรดเปลี่ยนเส้นทางอื่น",
        msgCloudDrive: "⚠️ เส้นทางโฟลเดอร์ไม่สามารถมี onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun ฯลฯ ได้ โปรดเปลี่ยนเส้นทางอื่น",
        msgConfirm: "⚠️ โปรดยืนยันว่าพื้นที่ทำงานไม่ได้ตั้งไว้ภายใต้เส้นทางของดิสก์ซิงค์ของบุคคลที่สาม มิฉะนั้นจะทำให้ข้อมูลเสียหาย (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun ฯลฯ) ดำเนินการต่อ?",
    },
    "tr": {
        title: "SiYuan",
        crashTip: "⚠️ Bir işleyici işleminin daha önce beklenmedik şekilde sonlandığı algılandı. Bu durum eklentiler, kod parçacıkları veya özel tema ve simgelerle ilgili olabilir. Güvenli modda başlatılması önerilir. Güvenli mod tüm eklentileri ve kod parçacıklarını devre dışı bırakır ve varsayılan tema ile simgeye geçer. İlgili içerik silinmez, ancak bu ayarlar başlatmadan sonra elle geri yüklenmelidir.",
        safeModeBtn: "🛡️ Güvenli modda başlat",
        normalBtn: "Normal şekilde başlat",
        slogan: "Düşüncenizi yeniden yapılandırın",
        wsTitle: "Çalışma alanları",
        missingTip: "⚠️ Son açılan çalışma alanı yolu bulunamadı",
        emptyHint: "Kullanılabilir çalışma alanı yok, lütfen yeni bir çalışma alanı yolu seçin",
        selectPath: "🗂️ Yeni bir çalışma alanı yolu seçin",
        selectPathDesc: "Çalışma alanı verileri depolamak için kullanılır, daha sonra üst çubuk menüsünde değiştirilebilir",
        workspace: "🗂️ Çalışma alanı",
        workspaceDesc: "Çalışma alanı verileri depolamak için kullanılır, daha sonra üst çubuk menüsünde değiştirilebilir",
        notice: "⚠️ Verileri senkronize etmek için üçüncü taraf bir senkronizasyon diski kullanmayın, aksi takdirde anormal çalışmaya ve veri hasarına neden olur",
        open: "Aç",
        selectBtn: "Seç",
        lang: "🌐 Dil",
        langDesc: "Kullanıcı arayüzü dili, daha sonra <kbd>Ayarlar</kbd> - <kbd>Görünüm</kbd> bölümünde değiştirilebilir",
        feedback: "Destek ve Geri Bildirim",
        community: "Kullanıcı topluluğu özeti",
        download: "İndir",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Çalışma alanını bölüm kök yolunda oluşturmayın, çalışma alanı olarak yeni bir klasör oluşturun",
        msgNotEmpty: "⚠️ Bu klasör başka dosyalar içeriyor, çalışma alanı olarak yeni bir klasör oluşturun",
        msgICloud: "⚠️ Bu klasör iCloud eşzamanlama yolunun altında, lütfen başka bir yol değiştirin",
        msgCloudDrive: "⚠️ Klasör yolu onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun vb. içeremez, lütfen başka bir yol değiştirin",
        msgConfirm: "⚠️ Çalışma alanının üçüncü taraf eşzamanlama diskinin yolu altında ayarlanmadığını onaylayın, aksi takdirde veri hasarına neden olur (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun vb.), devam edilsin mi?",
    },
    "uk": {
        title: "SiYuan",
        crashTip: "⚠️ Виявлено, що процес відображення раніше несподівано завершився. Це може бути пов'язано з плагінами, фрагментами коду або власними темами та піктограмами. Рекомендується запуск у безпечному режимі. Безпечний режим вимикає всі плагіни та фрагменти коду і перемикає на тему та піктограму за замовчуванням. Пов'язані матеріали не видаляються, але після запуску ці налаштування потрібно відновити вручну.",
        safeModeBtn: "🛡️ Запустити в безпечному режимі",
        normalBtn: "Запустити у звичайному режимі",
        slogan: "Реструктуруйте своє мислення",
        wsTitle: "Робочі простори",
        missingTip: "⚠️ Не вдалося знайти шлях до останнього відкритого робочого простору",
        emptyHint: "Немає доступних робочих просторів, виберіть новий шлях робочого простору",
        selectPath: "🗂️ Виберіть новий шлях робочого простору",
        selectPathDesc: "Робочий простір використовується для зберігання даних, який пізніше можна змінити в головному меню верхньої панелі",
        workspace: "🗂️ Робочий простір",
        workspaceDesc: "Робочий простір використовується для зберігання даних, який пізніше можна змінити в головному меню верхньої панелі",
        notice: "⚠️ Не використовуйте сторонній диск синхронізації для синхронізації даних, інакше це призведе до ненормальної роботи та пошкодження даних",
        open: "Відкрити",
        selectBtn: "Вибрати",
        lang: "🌐 Мова",
        langDesc: "Мова інтерфейсу користувача, яку пізніше можна змінити в <kbd>Налаштуваннях</kbd> - <kbd>Вигляд</kbd>",
        feedback: "Підтримка та зворотний зв'язок",
        community: "Огляд спільноти користувачів",
        download: "Завантажити",
        feedbackUrl: "https://liuyun.io/article/1686530886208",
        communityUrl: "https://liuyun.io/article/1687779743723",
        downloadUrl: "https://b3log.org/siyuan/en/download.html",
        msgPartitionRoot: "⚠️ Не створюйте робочий простір у кореневому шляху розділу, створіть нову папку як робочий простір",
        msgNotEmpty: "⚠️ Ця папка містить інші файли, створіть нову папку як робочий простір",
        msgICloud: "⚠️ Ця папка знаходиться під шляхом синхронізації iCloud, змініть інший шлях",
        msgCloudDrive: "⚠️ Шлях до папки не може містити onedrive, dropbox, google drive, pcloud, nutstore, baidunetdisk, weiyun тощо, змініть інший шлях",
        msgConfirm: "⚠️ Підтвердьте, що робочий простір не налаштований під шляхом стороннього диска синхронізації, інакше це спричинить пошкодження даних (iCloud/OneDrive/Dropbox/Google Drive/Nutstore/Baidu Netdisk/Tencent Weiyun тощо), продовжити?",
    },
};;

// 当前界面语言，由各 HTML 设置
let currentLang = decodeURIComponent(getSearch("lang"));

// 应用指定语言文案到 DOM 并返回当前语言的文案对象
const applyLang = (lang) => {
    const langData = I18N_BASE[lang] || I18N_BASE["en"];
    document.title = `${langData.title} v${getSearch("v")}`;
    document.querySelectorAll("[data-i18n]").forEach(item => {
        const key = item.getAttribute("data-i18n");
        if (langData[key]) {
            item.textContent = langData[key];
        }
    });
    // 含 HTML 标签（如 <kbd>）的文案用 innerHTML
    document.querySelectorAll("[data-i18n-html]").forEach(item => {
        const key = item.getAttribute("data-i18n-html");
        if (langData[key]) {
            item.innerHTML = langData[key];
        }
    });
    document.querySelectorAll("[data-i18n-href]").forEach(item => {
        const key = item.getAttribute("data-i18n-href");
        if (langData[key]) {
            item.href = langData[key];
        }
    });
    currentLang = lang;
    return langData;
};

// 工作空间路径校验函数
const isPartitionRootPath = (absPath) => {
    const path = require("path");
    return path.parse(absPath).root === absPath;
};

const isEmptyDir = (absPath) => {
    const fs = require("fs");
    let files;
    try {
        files = fs.readdirSync(absPath).filter(file => file !== ".DS_Store");
    } catch (err) {
        return false;
    }
    return 0 === files.length;
};

const isWorkspaceDir = (absPath) => {
    const path = require("path");
    const fs = require("fs");
    const conf = path.join(absPath, "conf", "conf.json");
    let data;
    try {
        data = fs.readFileSync(conf, "utf8");
    } catch (err) {
        return false;
    }
    return data.includes("kernelVersion");
};

const isCloudDrivePath = (absPath) => {
    const absPathLower = absPath.toLowerCase();
    return -1 < absPathLower.indexOf("onedrive") || -1 < absPathLower.indexOf("dropbox") ||
        -1 < absPathLower.indexOf("google drive") || -1 < absPathLower.indexOf("pcloud") ||
        -1 < absPathLower.indexOf("坚果云") || -1 < absPathLower.indexOf("nutstore") ||
        -1 < absPathLower.indexOf("百度网盘") || -1 < absPathLower.indexOf("baidunetdisk") ||
        -1 < absPathLower.indexOf("腾讯微云") || -1 < absPathLower.indexOf("weiyun");
};

// macOS 端对工作空间放置在 iCloud 路径下做检查 https://github.com/siyuan-note/siyuan/issues/7747
const isICloudPath = (absPath) => {
    const os = require("os");
    if ("darwin" !== os.platform()) {
        return false;
    }
    const path = require("path");
    const homePath = decodeURIComponent(getSearch("home"));
    const absPathLower = absPath.toLowerCase();
    const iCloudRoot = path.join(homePath, "Library", "Mobile Documents");
    if (!simpleCheckIcloudPath(absPath, homePath)) {
        // 简单判断无法通过则复杂验证
        const allFiles = walk(iCloudRoot);
        for (const file of allFiles) {
            if (-1 < absPathLower.indexOf(file.toLowerCase())) {
                return true;
            }
        }
    }
    return false;
};

// 简单判断 iCloud 同步目录
// 不允许 为桌面 文档 和 iCloud 文件夹 和软链接
const simpleCheckIcloudPath = (absPath, homePath) => {
    const fs = require("fs");
    const path = require("path");
    let stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink()) {
        return false;
    }
    const absPathLower = absPath.toLowerCase();
    const iCloudRoot = path.join(homePath, "Library", "Mobile Documents");
    if (absPathLower.startsWith(iCloudRoot.toLowerCase())) {
        return false;
    }
    const documentsRoot = path.join(homePath, "Documents");
    if (absPathLower.startsWith(documentsRoot.toLowerCase())) {
        return false;
    }
    const desktopRoot = path.join(homePath, "Desktop");
    if (absPathLower.startsWith(desktopRoot.toLowerCase())) {
        return false;
    }
    return true;
};

const walk = (dir, files = []) => {
    const fs = require("fs");
    const path = require("path");
    let dirFiles;
    try {
        if (!fs.existsSync(dir)) {
            console.log("dir [" + dir + "] not exists");
            return files;
        }
        dirFiles = fs.readdirSync(dir);
    } catch (e) {
        console.error("read dir [" + dir + "] failed: ", e);
        return files;
    }
    for (const f of dirFiles) {
        let stat = fs.lstatSync(dir + path.sep + f);
        if (stat.isSymbolicLink()) {
            files.push(fs.readlinkSync(dir + path.sep + f));
            continue;
        }
        if (stat.isDirectory()) {
            // 如果已经遍历过则不再遍历
            if (files.includes(dir + path.sep + f)) {
                continue;
            }
            files.push(dir + path.sep + f);
            walk(dir + path.sep + f, files);
        }
    }
    return files;
};

// 选择工作空间目录并做路径校验，返回选中的路径；取消或校验失败返回 null
const chooseWorkspacePath = async (langData) => {
    const path = require("path");
    const fs = require("fs");
    const {ipcRenderer} = require("electron");

    let defaultWorkspace = path.join(decodeURIComponent(getSearch("home")), "SiYuan");
    if ("darwin" === process.platform) {
        // Change the initial workspace path to ~/Library/Application Support/SiYuan on macOS https://github.com/siyuan-note/siyuan/issues/17095
        defaultWorkspace = path.join(decodeURIComponent(getSearch("home")), "Library", "Application Support", "SiYuan");
    }
    if (!fs.existsSync(defaultWorkspace)) {
        fs.mkdirSync(defaultWorkspace, {mode: 0o755, recursive: true});
    }

    const result = await ipcRenderer.invoke("siyuan-get", {
        cmd: "showOpenDialog",
        defaultPath: defaultWorkspace,
        properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled) {
        return null;
    }
    const initPath = result.filePaths[0];

    if (isPartitionRootPath(initPath)) {
        alert(langData.msgPartitionRoot);
        return null;
    }
    if (!isWorkspaceDir(initPath) && !isEmptyDir(initPath)) {
        alert(langData.msgNotEmpty);
        return null;
    }
    if (isICloudPath(initPath)) {
        alert(langData.msgICloud);
        return null;
    }
    if (isCloudDrivePath(initPath)) {
        alert(langData.msgCloudDrive);
        return null;
    }
    if (!confirm(langData.msgConfirm)) {
        return null;
    }
    if (!fs.existsSync(initPath)) {
        fs.mkdirSync(initPath, {mode: 0o755, recursive: true});
    }
    return initPath;
};

// 窗口通用初始化：macOS body class、关闭/最小化按钮 IPC
const initWindowChrome = () => {
    const {ipcRenderer} = require("electron");
    if ("darwin" === process.platform) {
        document.body.classList.add("darwin");
    }
    document.getElementById("close").addEventListener("click", () => {
        ipcRenderer.send("siyuan-first-quit");
    });
    document.getElementById("min").addEventListener("click", () => {
        ipcRenderer.send("siyuan-cmd", "minimize");
    });
};

window.getSearch = getSearch;
window.I18N_BASE = I18N_BASE;
window.applyLang = applyLang;
window.currentLang = currentLang;
window.isPartitionRootPath = isPartitionRootPath;
window.isEmptyDir = isEmptyDir;
window.isWorkspaceDir = isWorkspaceDir;
window.isCloudDrivePath = isCloudDrivePath;
window.isICloudPath = isICloudPath;
window.simpleCheckIcloudPath = simpleCheckIcloudPath;
window.walk = walk;
window.chooseWorkspacePath = chooseWorkspacePath;
window.initWindowChrome = initWindowChrome;
