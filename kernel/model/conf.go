// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"crypto/sha1"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/Xuanwo/go-locale"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/text/language"
)

var Conf *AppConf

// AppConf 维护应用元数据，保存在 ~/.siyuan/conf.json。
type AppConf struct {
	LogLevel       string           `json:"logLevel"`       // 日志级别：off, trace, debug, info, warn, error, fatal
	Appearance     *conf.Appearance `json:"appearance"`     // 外观
	Langs          []*conf.Lang     `json:"langs"`          // 界面语言列表
	Lang           string           `json:"lang"`           // 选择的界面语言，同 Appearance.Lang
	FileTree       *conf.FileTree   `json:"fileTree"`       // 文档面板
	Tag            *conf.Tag        `json:"tag"`            // 标签面板
	Editor         *conf.Editor     `json:"editor"`         // 编辑器配置
	Export         *conf.Export     `json:"export"`         // 导出配置
	Graph          *conf.Graph      `json:"graph"`          // 关系图配置
	UILayout       *conf.UILayout   `json:"uiLayout"`       // 界面布局。不要直接使用，使用 GetUILayout() 和 SetUILayout() 方法
	UserData       string           `json:"userData"`       // 社区用户信息，对 User 加密存储
	User           *conf.User       `json:"-"`              // 社区用户内存结构，不持久化。不要直接使用，使用 GetUser() 和 SetUser() 方法
	Account        *conf.Account    `json:"account"`        // 帐号配置
	ReadOnly       bool             `json:"readonly"`       // 是否是以只读模式运行
	ServerAddrs    []string         `json:"serverAddrs"`    // 本地服务器地址列表
	AccessAuthCode string           `json:"accessAuthCode"` // 锁屏密码
	System         *conf.System     `json:"system"`         // 系统配置
	Keymap         *conf.Keymap     `json:"keymap"`         // 快捷键配置
	Sync           *conf.Sync       `json:"sync"`           // 同步配置
	Search         *conf.Search     `json:"search"`         // 搜索配置
	Flashcard      *conf.Flashcard  `json:"flashcard"`      // 闪卡配置
	AI             *conf.AI         `json:"ai"`             // 人工智能配置
	Secrets        *conf.Secrets    `json:"secrets"`        // 全局密钥库
	Variables      *conf.Variables  `json:"variables"`      // 全局变量库
	Bazaar         *conf.Bazaar     `json:"bazaar"`         // 集市配置
	Stat           *conf.Stat       `json:"stat"`           // 统计
	Api            *conf.API        `json:"api"`            // API
	Repo           *conf.Repo       `json:"repo"`           // 数据仓库
	Publish        *conf.Publish    `json:"publish"`        // 发布服务
	OpenHelp       bool             `json:"openHelp"`       // 启动后是否需要打开用户指南
	ShowChangelog  bool             `json:"showChangelog"`  // 是否显示版本更新日志
	CloudRegion    int              `json:"cloudRegion"`    // 云端区域，0：中国大陆，1：北美
	Snippet        *conf.Snpt       `json:"snippet"`        // 代码片段
	DataIndexState int              `json:"dataIndexState"` // 数据索引状态，0：已索引，1：未索引
	CookieKey      string           `json:"cookieKey"`      // 用于加密 Cookie 的密钥

	m        *sync.RWMutex // 配置数据锁
	userLock *sync.RWMutex // 用户数据独立锁，避免与配置保存操作竞争
}

func NewAppConf() *AppConf {
	return &AppConf{
		LogLevel: "debug",
		m:        &sync.RWMutex{},
		userLock: &sync.RWMutex{},
	}
}

func (conf *AppConf) GetUILayout() *conf.UILayout {
	conf.m.Lock()
	defer conf.m.Unlock()
	return conf.UILayout
}

func (conf *AppConf) SetUILayout(uiLayout *conf.UILayout) {
	conf.m.Lock()
	defer conf.m.Unlock()
	conf.UILayout = uiLayout
}

func (conf *AppConf) GetUser() *conf.User {
	conf.userLock.RLock()
	defer conf.userLock.RUnlock()
	return conf.User
}

func (conf *AppConf) SetUser(user *conf.User) {
	conf.userLock.Lock()
	defer conf.userLock.Unlock()
	conf.User = user
}

func InitConf() {
	initLang()

	Conf = NewAppConf()
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if gulu.File.IsExist(confPath) {
		if data, err := os.ReadFile(confPath); err != nil {
			logging.LogErrorf("load conf [%s] failed: %s", confPath, err)
		} else {
			// 解析失败时保留已成功写入的字段；未导出字段（m、userLock）与未触及的导出字段保持 NewAppConf() 初值。
			if err = gulu.JSON.UnmarshalJSON(data, Conf); err != nil {
				logging.LogWarnf("parse conf failed, parsed fields retained: %s", err)
			} else {
				logging.LogInfof("loaded conf [%s]", confPath)
			}

			if conf.NeedsAIMigration(data) {
				Conf.AI = conf.MigrateAI(data)
				Conf.Save()
				logging.LogInfof("migrated AI config [%s]", confPath)
			}
		}
	}

	if "" != util.Lang {
		initialized := false
		if util.IsMobileContainer() {
			// 移动端以上次设置的外观语言为准
			if "" != Conf.Lang && util.Lang != Conf.Lang {
				util.Lang = Conf.Lang
				logging.LogInfof("use the last specified language [%s]", util.Lang)
				initialized = true
			}
		}

		if !initialized {
			Conf.Lang = util.Lang
			logging.LogInfof("initialized the specified language [%s]", util.Lang)
		}
	} else if "" == Conf.Lang {
		// 未指定外观语言时使用系统语言
		// DetectAll 返回按优先级排序的系统语言 Tag 列表（如 en-US、en）
		deviceLangTags, detectErr := locale.DetectAll()
		if detectErr != nil {
			logging.LogDebugf("check device locale failed [%s], using default language [en]", detectErr)
			util.Lang = "en"
		} else if len(deviceLangTags) == 0 {
			logging.LogDebugf("device locale list is empty, using default language [en]")
			util.Lang = "en"
		} else {
			// siYuanLangNames 与 bcp47Tags 按相同顺序排列，Match 返回的 matchIndex 即对应 siYuanLangNames 中的语言名
			siYuanLangNames := make([]string, 0, len(util.Langs))
			bcp47Tags := make([]language.Tag, 0, len(util.Langs))
			for langName := range util.Langs {
				bcp47Tag, err := language.Parse(langName)
				if err != nil {
					logging.LogErrorf("load language [%s] failed: %s", langName, err)
					continue
				}
				siYuanLangNames = append(siYuanLangNames, langName)
				bcp47Tags = append(bcp47Tags, bcp47Tag)
			}
			util.Lang = "en"
			if len(bcp47Tags) > 0 {
				matcher := language.NewMatcher(bcp47Tags)
				_, matchIndex, confidence := matcher.Match(deviceLangTags...)
				// 系统语言与 SiYuan 支持列表不存在有效匹配时 confidence 为 No，保持默认 en
				if confidence != language.No {
					util.Lang = siYuanLangNames[matchIndex]
				}
			}
			logging.LogInfof("initialized language [%s] based on device locale", util.Lang)
		}
		Conf.Lang = util.Lang
	} else {
		// conf.json 已保存外观语言
		util.Lang = Conf.Lang
	}

	// 历史下划线语言代码迁移为 BCP 47 新值（zh_CN → zh-CN 等）
	if migrated := util.LangToBCP47(Conf.Lang); migrated != Conf.Lang {
		logging.LogInfof("migrate legacy lang [%s] → [%s]", Conf.Lang, migrated)
		Conf.Lang = migrated
		util.Lang = migrated
	}

	Conf.Langs = loadLangs()
	if nil == Conf.Appearance {
		Conf.Appearance = conf.NewAppearance()
	}
	var langOK bool
	for _, l := range Conf.Langs {
		if Conf.Lang == l.Name {
			langOK = true
			break
		}
	}
	if !langOK {
		Conf.Lang = "en"
		util.Lang = Conf.Lang
	}
	Conf.Appearance.Lang = Conf.Lang

	// 历史下划线命名的 i18n 文件（zh_CN.json 等）已重命名为 BCP 47（zh-CN.json 等），
	// 清理 ConfDir/appearance/langs/ 下的旧名残留，避免僵尸文件。
	if langsDir := filepath.Join(util.AppearancePath, "langs"); gulu.File.IsDir(langsDir) {
		if entries, err := os.ReadDir(langsDir); err == nil {
			for _, entry := range entries {
				name := entry.Name()
				if entry.IsDir() || !strings.HasSuffix(name, ".json") {
					continue
				}
				stem := strings.TrimSuffix(name, ".json")
				if _, ok := util.LangLegacyToBCP47[stem]; !ok {
					continue
				}
				os.RemoveAll(filepath.Join(langsDir, name))
			}
		}
	}
	if "ant" == Conf.Appearance.Icon || "material" == Conf.Appearance.Icon {
		// v3.7.0 移除了 ant/material 图标包，如果用户之前选择了这两个其中之一，升级后改为 litheness 图标包，避免图标显示异常 https://github.com/siyuan-note/siyuan/issues/7976
		Conf.Appearance.Icon = "litheness"
	}
	os.RemoveAll(filepath.Join(util.IconsPath, "ant"))
	os.RemoveAll(filepath.Join(util.IconsPath, "material"))
	if nil == Conf.UILayout {
		Conf.UILayout = &conf.UILayout{}
	}
	if nil == Conf.Keymap {
		Conf.Keymap = &conf.Keymap{}
	}
	if "" == Conf.Appearance.CodeBlockThemeDark {
		Conf.Appearance.CodeBlockThemeDark = "dracula"
	}
	if "" == Conf.Appearance.CodeBlockThemeLight {
		Conf.Appearance.CodeBlockThemeLight = "github"
	}
	if nil == Conf.Appearance.StatusBar {
		Conf.Appearance.StatusBar = &util.StatusBar{}
	}
	util.StatusBarCfg = Conf.Appearance.StatusBar
	if nil == Conf.Appearance.Notifications {
		Conf.Appearance.Notifications = util.NewNotifications()
	}
	util.NotificationsCfg = Conf.Appearance.Notifications
	if nil == Conf.FileTree {
		Conf.FileTree = conf.NewFileTree()
	}
	if 1 > Conf.FileTree.MaxListCount {
		Conf.FileTree.MaxListCount = 512
	}
	if 1 > Conf.FileTree.MaxOpenTabCount {
		Conf.FileTree.MaxOpenTabCount = 8
	}
	if 32 < Conf.FileTree.MaxOpenTabCount {
		Conf.FileTree.MaxOpenTabCount = 32
	}
	Conf.FileTree.DocCreateSavePath = util.TrimSpaceInPath(Conf.FileTree.DocCreateSavePath)
	Conf.FileTree.RefCreateSavePath = util.TrimSpaceInPath(Conf.FileTree.RefCreateSavePath)
	Conf.FileTree.ShorthandSavePath = util.TrimSpaceInPath(Conf.FileTree.ShorthandSavePath)
	util.UseSingleLineSave = Conf.FileTree.UseSingleLineSave
	if 2 > Conf.FileTree.LargeFileWarningSize {
		Conf.FileTree.LargeFileWarningSize = 8
	}
	util.LargeFileWarningSize = Conf.FileTree.LargeFileWarningSize
	if nil == Conf.FileTree.CreateDocAtTop { // v3.4.0 之前的版本没有该字段，设置默认值为 true，即在顶部创建新文档，不改变用户习惯
		Conf.FileTree.CreateDocAtTop = func() *bool { b := true; return &b }()
	}

	if conf.MinFileTreeRecentDocsListCount > Conf.FileTree.RecentDocsMaxListCount {
		Conf.FileTree.RecentDocsMaxListCount = conf.MinFileTreeRecentDocsListCount
	}
	if conf.MaxFileTreeRecentDocsListCount < Conf.FileTree.RecentDocsMaxListCount {
		Conf.FileTree.RecentDocsMaxListCount = conf.MaxFileTreeRecentDocsListCount
	}

	util.CurrentCloudRegion = Conf.CloudRegion

	if nil == Conf.Tag {
		Conf.Tag = conf.NewTag()
	}

	defaultEditor := conf.NewEditor()
	if nil == Conf.Editor {
		Conf.Editor = defaultEditor
	}

	// 新增字段的默认值，使用指针类型来区分字段不存在（nil）和用户设置为 0（非 nil）
	if nil == Conf.Editor.BacklinkSort {
		Conf.Editor.BacklinkSort = defaultEditor.BacklinkSort
	}
	if nil == Conf.Editor.BackmentionSort {
		Conf.Editor.BackmentionSort = defaultEditor.BackmentionSort
	}
	if 1 > len(Conf.Editor.Emoji) {
		Conf.Editor.Emoji = []string{}
	}
	for i, emoji := range Conf.Editor.Emoji {
		if strings.Contains(emoji, ".") {
			// XSS through emoji name https://github.com/siyuan-note/siyuan/issues/15034
			emoji = util.FilterUploadEmojiFileName(emoji)
			Conf.Editor.Emoji[i] = emoji
		}
	}
	if 9 > Conf.Editor.FontSize || 72 < Conf.Editor.FontSize {
		Conf.Editor.FontSize = 16
	}
	if "" == Conf.Editor.PlantUMLServePath {
		Conf.Editor.PlantUMLServePath = "https://www.plantuml.com/plantuml/svg/~1"
	}
	if 1 > Conf.Editor.BlockRefDynamicAnchorTextMaxLen {
		Conf.Editor.BlockRefDynamicAnchorTextMaxLen = 64
	}
	if 5120 < Conf.Editor.BlockRefDynamicAnchorTextMaxLen {
		Conf.Editor.BlockRefDynamicAnchorTextMaxLen = 5120
	}
	if 1440 < Conf.Editor.GenerateHistoryInterval {
		Conf.Editor.GenerateHistoryInterval = 1440
	}
	if 1 > Conf.Editor.HistoryRetentionDays {
		Conf.Editor.HistoryRetentionDays = 30
	}
	if 3650 < Conf.Editor.HistoryRetentionDays {
		Conf.Editor.HistoryRetentionDays = 3650
	}
	if nil == Conf.Editor.FloatWindowDelay {
		v := 620
		Conf.Editor.FloatWindowDelay = &v
	} else {
		*Conf.Editor.FloatWindowDelay = max(0, min(2000, *Conf.Editor.FloatWindowDelay))
	}
	if conf.MinDynamicLoadBlocks > Conf.Editor.DynamicLoadBlocks {
		Conf.Editor.DynamicLoadBlocks = conf.MinDynamicLoadBlocks
	}
	if 1 > len(Conf.Editor.SpellcheckLanguages) {
		Conf.Editor.SpellcheckLanguages = []string{"en-US"}
	}
	if 0 > Conf.Editor.BacklinkExpandCount {
		Conf.Editor.BacklinkExpandCount = 0
	}
	if -1 > Conf.Editor.BackmentionExpandCount {
		Conf.Editor.BackmentionExpandCount = -1
	}
	if nil == Conf.Editor.Markdown {
		Conf.Editor.Markdown = &util.Markdown{}
	}
	util.MarkdownSettings = Conf.Editor.Markdown

	if nil == Conf.Export {
		Conf.Export = conf.NewExport()
	}
	if 0 == Conf.Export.BlockRefMode || 1 == Conf.Export.BlockRefMode || 5 == Conf.Export.BlockRefMode {
		// 废弃导出选项引用块转换为原始块和引述块 https://github.com/siyuan-note/siyuan/issues/3155
		// 锚点哈希模式和脚注模式合并 https://github.com/siyuan-note/siyuan/issues/13331
		Conf.Export.BlockRefMode = 4 // 改为脚注+锚点哈希
	}
	if "" == Conf.Export.PandocBin {
		Conf.Export.PandocBin = util.PandocBinPath
	}

	if nil == Conf.Graph || nil == Conf.Graph.Local || nil == Conf.Graph.Global {
		Conf.Graph = conf.NewGraph()
	}

	if nil == Conf.System {
		Conf.System = conf.NewSystem()
		Conf.OpenHelp = true
	} else {
		cmp := semver.Compare("v"+util.Ver, "v"+Conf.System.KernelVersion)
		if 0 < cmp {
			logging.LogInfof("upgraded from version [%s] to [%s]", Conf.System.KernelVersion, util.Ver)
			Conf.ShowChangelog = true
		} else if 0 > cmp {
			logging.LogInfof("downgraded from version [%s] to [%s]", Conf.System.KernelVersion, util.Ver)
		}

		Conf.System.KernelVersion = util.Ver
		Conf.System.IsInsider = util.IsInsider
	}
	if nil == Conf.System.NetworkProxy {
		Conf.System.NetworkProxy = &conf.NetworkProxy{}
	}
	if "" == Conf.System.ID {
		Conf.System.ID = util.GetDeviceID()
	}
	if "" == Conf.System.Name {
		Conf.System.Name = util.GetDeviceName()
	}
	if util.ContainerStd == util.Container {
		Conf.System.ID = util.GetDeviceID()
		Conf.System.Name = util.GetDeviceName()
	}
	Conf.System.DisabledFeatures = util.DisabledFeatures
	if 1 > len(Conf.System.DisabledFeatures) {
		Conf.System.DisabledFeatures = []string{}
	}

	Conf.System.AppDir = util.WorkingDir
	Conf.System.ConfDir = util.ConfDir
	Conf.System.HomeDir = util.HomeDir
	Conf.System.WorkspaceDir = util.WorkspaceDir
	Conf.System.DataDir = util.DataDir
	Conf.System.Container = util.Container
	Conf.System.IsMicrosoftStore = util.ISMicrosoftStore
	if util.ISMicrosoftStore {
		logging.LogInfof("using Microsoft Store edition")
	}
	Conf.System.OS = runtime.GOOS
	Conf.System.OSPlatform = util.GetOSPlatform()

	docxTemplate := util.RemoveInvalid(Conf.Export.DocxTemplate)
	if "" != docxTemplate {
		params := util.RemoveInvalid(Conf.Export.PandocParams)
		if gulu.File.IsExist(docxTemplate) && !strings.Contains(params, "--reference-doc") && !Conf.System.IsMicrosoftStore {
			if !strings.HasPrefix(docxTemplate, "\"") {
				docxTemplate = "\"" + docxTemplate + "\""
			}
			params += " --reference-doc " + docxTemplate
			Conf.Export.PandocParams = strings.TrimSpace(params)
		}
		Conf.Export.DocxTemplate = ""
		Conf.Save()
	}

	if nil == Conf.Snippet {
		Conf.Snippet = conf.NewSnpt()
	}

	if "" != Conf.UserData {
		Conf.SetUser(loadUserFromConf())
	}
	if nil == Conf.Account {
		Conf.Account = conf.NewAccount()
	}

	if nil == Conf.Sync {
		Conf.Sync = conf.NewSync()
	}
	if 0 == Conf.Sync.Mode {
		Conf.Sync.Mode = 1
	}
	if 30 > Conf.Sync.Interval {
		Conf.Sync.Interval = 30
	}
	if 60*60*12 < Conf.Sync.Interval {
		Conf.Sync.Interval = 60 * 60 * 12
	}
	if nil == Conf.Sync.S3 {
		Conf.Sync.S3 = &conf.S3{PathStyle: true, SkipTlsVerify: true}
	}
	Conf.Sync.S3.Endpoint = util.NormalizeEndpoint(Conf.Sync.S3.Endpoint)
	Conf.Sync.S3.Timeout = util.NormalizeTimeout(Conf.Sync.S3.Timeout)
	Conf.Sync.S3.ConcurrentReqs = util.NormalizeConcurrentReqs(Conf.Sync.S3.ConcurrentReqs, conf.ProviderS3)
	if nil == Conf.Sync.WebDAV {
		Conf.Sync.WebDAV = &conf.WebDAV{SkipTlsVerify: true}
	}
	Conf.Sync.WebDAV.Endpoint = util.NormalizeEndpoint(Conf.Sync.WebDAV.Endpoint)
	Conf.Sync.WebDAV.Timeout = util.NormalizeTimeout(Conf.Sync.WebDAV.Timeout)
	Conf.Sync.WebDAV.ConcurrentReqs = util.NormalizeConcurrentReqs(Conf.Sync.WebDAV.ConcurrentReqs, conf.ProviderWebDAV)
	if nil == Conf.Sync.Local {
		Conf.Sync.Local = &conf.Local{}
	}
	Conf.Sync.Local.Endpoint = util.NormalizeLocalPath(Conf.Sync.Local.Endpoint)
	Conf.Sync.Local.Timeout = util.NormalizeTimeout(Conf.Sync.Local.Timeout)
	Conf.Sync.Local.ConcurrentReqs = util.NormalizeConcurrentReqs(Conf.Sync.Local.ConcurrentReqs, conf.ProviderLocal)

	if util.ContainerDocker == util.Container {
		Conf.Sync.Perception = false
	}

	if nil == Conf.Api {
		Conf.Api = conf.NewAPI()
	}

	if nil == Conf.Bazaar {
		Conf.Bazaar = conf.NewBazaar()
	}

	if nil == Conf.Publish {
		Conf.Publish = conf.NewPublish()
	}
	if Conf.OpenHelp && Conf.Publish.Enable {
		Conf.OpenHelp = false
	}

	if nil == Conf.Repo {
		Conf.Repo = conf.NewRepo()
	}
	if timingEnv := os.Getenv("SIYUAN_SYNC_INDEX_TIMING"); "" != timingEnv {
		val, err := strconv.Atoi(timingEnv)
		if err == nil {
			Conf.Repo.SyncIndexTiming = int64(val)
		}
	}
	if 12000 > Conf.Repo.SyncIndexTiming {
		Conf.Repo.SyncIndexTiming = 12 * 1000
	}
	if 1 > Conf.Repo.IndexRetentionDays {
		Conf.Repo.IndexRetentionDays = 180
	}
	if 1 > Conf.Repo.RetentionIndexesDaily {
		Conf.Repo.RetentionIndexesDaily = 2
	}
	if 0 < len(Conf.Repo.Key) {
		logging.LogInfof("repo key [%x]", sha1.Sum(Conf.Repo.Key))
	}

	if nil == Conf.Search {
		Conf.Search = conf.NewSearch()
	}
	if 1 > Conf.Search.Limit {
		Conf.Search.Limit = 64
	}
	if 32 > Conf.Search.Limit {
		Conf.Search.Limit = 32
	}
	if 1 > Conf.Search.BacklinkMentionKeywordsLimit {
		Conf.Search.BacklinkMentionKeywordsLimit = 512
	}
	if nil == Conf.Search.HanSensitive {
		Conf.Search.SetHanSensitive(true)
	}
	sql.SetHanSensitive(Conf.Search.HanSensitiveVal())

	if nil == Conf.Stat {
		Conf.Stat = conf.NewStat()
	}

	if nil == Conf.Flashcard {
		Conf.Flashcard = conf.NewFlashcard()
	}
	if 0 > Conf.Flashcard.NewCardLimit {
		Conf.Flashcard.NewCardLimit = 20
	}
	if 0 > Conf.Flashcard.ReviewCardLimit {
		Conf.Flashcard.ReviewCardLimit = 200
	}
	if 0 >= Conf.Flashcard.RequestRetention || 1 <= Conf.Flashcard.RequestRetention {
		Conf.Flashcard.RequestRetention = conf.NewFlashcard().RequestRetention
	}
	if 0 >= Conf.Flashcard.MaximumInterval || 36500 <= Conf.Flashcard.MaximumInterval {
		Conf.Flashcard.MaximumInterval = conf.NewFlashcard().MaximumInterval
	}
	if "" == Conf.Flashcard.Weights {
		Conf.Flashcard.Weights = conf.NewFlashcard().Weights
	}
	if 19 != len(strings.Split(Conf.Flashcard.Weights, ",")) {
		defaultWeights := conf.DefaultFSRSWeights()
		msg := "fsrs store weights length must be [19]"
		logging.LogWarnf("%s , given [%s], reset to default weights [%s]", msg, Conf.Flashcard.Weights, defaultWeights)
		Conf.Flashcard.Weights = defaultWeights
		go func() {
			util.WaitForUILoaded()
			task.AppendAsyncTaskWithDelay(task.PushMsg, 2*time.Second, util.PushErrMsg, msg, 15000)
		}()
	}
	isInvalidFlashcardWeights := false
	for _, w := range strings.Split(Conf.Flashcard.Weights, ",") {
		if _, err := strconv.ParseFloat(strings.TrimSpace(w), 64); err != nil {
			isInvalidFlashcardWeights = true
			break
		}
	}
	if isInvalidFlashcardWeights {
		defaultWeights := conf.DefaultFSRSWeights()
		msg := "fsrs store weights contain invalid number"
		logging.LogWarnf("%s, given [%s], reset to default weights [%s]", msg, Conf.Flashcard.Weights, defaultWeights)
		Conf.Flashcard.Weights = defaultWeights
		go func() {
			util.WaitForUILoaded()
			task.AppendAsyncTaskWithDelay(task.PushMsg, 2*time.Second, util.PushErrMsg, msg, 15000)
		}()
	}

	if nil == Conf.AI {
		Conf.AI = conf.NewAI()
	} else {
		Conf.AI.DecryptAPIKeys()
	}
	Conf.AI.Normalize()

	if nil == Conf.Secrets {
		Conf.Secrets = conf.NewSecrets()
	} else {
		Conf.Secrets.Decrypt()
	}

	if nil == Conf.Variables {
		Conf.Variables = conf.NewVariables()
	}

	for _, p := range Conf.AI.Providers {
		if p == nil || len(p.APIKey) == 0 {
			continue
		}
		for _, m := range p.Models {
			if m.Name == "" {
				continue
			}
			logging.LogInfof("AI provider enabled\n"+
				"    baseURL=%s\n"+
				"    timeout=%ds\n"+
				"    model=%s\n"+
				"    maxCompletionTokens=%d\n"+
				"    temperature=%.1f\n"+
				"    maxHistoryMessages=%d",
				p.BaseURL,
				p.RequestTimeout,
				m.Name,
				Conf.AI.Editing.MaxCompletionTokens,
				Conf.AI.Editing.Temperature,
				Conf.AI.Editing.MaxHistoryMessages)
		}
	}

	if Conf.AI.Embedding != nil && len(Conf.AI.Embedding.APIKey) > 0 {
		logging.LogInfof("embedding API enabled\n"+
			"    baseURL=%s\n"+
			"    model=%s",
			Conf.AI.Embedding.BaseURL,
			Conf.AI.Embedding.Name)
	}

	Conf.ReadOnly = util.ReadOnly

	if "" != util.AccessAuthCode {
		Conf.AccessAuthCode = util.AccessAuthCode
	}
	Conf.AccessAuthCode = util.RemoveInvalid(Conf.AccessAuthCode)
	Conf.AccessAuthCode = strings.TrimSpace(Conf.AccessAuthCode)

	if 1 == Conf.DataIndexState {
		// 上次未正常完成数据索引，后续会由 recoverIndexQueue() 恢复
		logging.LogInfof("data index state is [%d], will recover through index queue", Conf.DataIndexState)
	}

	Conf.DataIndexState = 0

	if cookieKey := readCookieKey(); "" != cookieKey {
		Conf.CookieKey = cookieKey
	} else {
		if "" == Conf.CookieKey {
			Conf.CookieKey = gulu.Rand.String(16)
		}
		writeCookieKey(Conf.CookieKey)
	}

	Conf.Save()

	// 安全模式：渲染进程崩溃恢复后由桌面端主进程通过 --safe-mode 注入。
	// safeMode 是纯运行时状态，不随 conf.json 持久化（Save 时会被排除），故每次启动都按 util.SafeMode 重新赋值。
	Conf.System.SafeMode = util.SafeMode
	if util.SafeMode {
		// 直接覆盖外观、集市、代码片段相关配置并持久化，禁用代码片段、插件、自定义主题与图标，以排除扩展导致再次崩溃的可能。
		// 注意：这是破坏性操作，会覆盖用户原有配置，后续不会自动恢复。
		Conf.Appearance.ThemeLight = "daylight"
		Conf.Appearance.ThemeDark = "midnight"
		Conf.Appearance.Icon = "litheness"
		Conf.Appearance.ThemeJS = false
		Conf.Bazaar.PetalDisabled = true
		Conf.Snippet.EnabledCSS = false
		Conf.Snippet.EnabledJS = false
		Conf.Save()
		logging.LogInfof("booted in safe mode")
	}

	// CLI 子命令通过 --log-level 显式指定日志级别时（util.CLILogLevel 非空），优先使用命令行级别，
	// 不再用 conf.json 的 system.logLevel 覆盖，使命令行参数在初始化早期即生效。
	if "" == util.CLILogLevel {
		logging.SetLogLevel(Conf.LogLevel)
	}

	util.SetNetworkProxy(Conf.System.NetworkProxy.String())

	go util.InitPandoc()
	go util.InitTesseract()
}

func readCookieKey() (cookieKey string) {
	cookieKeyPath := filepath.Join(util.HomeDir, ".config", "siyuan", "cookie.key")
	if !gulu.File.IsExist(cookieKeyPath) {
		return
	}

	data, err := os.ReadFile(cookieKeyPath)
	if err != nil {
		logging.LogErrorf("read cookie key file [%s] failed: %s", cookieKeyPath, err)
		return
	}

	cookieKey = string(bytes.TrimSpace(data))
	return
}

func writeCookieKey(cookieKey string) {
	cookieKeyPath := filepath.Join(util.HomeDir, ".config", "siyuan", "cookie.key")
	if gulu.File.IsExist(cookieKeyPath) {
		return
	}

	if err := os.WriteFile(cookieKeyPath, []byte(cookieKey), 0644); err != nil {
		logging.LogErrorf("save cookie key file [%s] failed: %s", cookieKeyPath, err)
	}
}

func initLang() {
	p := filepath.Join(util.WorkingDir, "appearance", "langs")
	dir, err := os.Open(p)
	if err != nil {
		logging.LogErrorf("open language configuration folder [%s] failed: %s", p, err)
		util.ReportFileSysFatalError(err)
		return
	}
	defer dir.Close()

	langNames, err := dir.Readdirnames(-1)
	if err != nil {
		logging.LogErrorf("list language configuration folder [%s] failed: %s", p, err)
		util.ReportFileSysFatalError(err)
		return
	}

	for _, langName := range langNames {
		jsonPath := filepath.Join(p, langName)
		data, err := os.ReadFile(jsonPath)
		if err != nil {
			logging.LogErrorf("read language configuration [%s] failed: %s", jsonPath, err)
			continue
		}
		data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
		langMap := map[string]any{}
		if err := gulu.JSON.UnmarshalJSON(data, &langMap); err != nil {
			logging.LogErrorf("parse language configuration failed [%s] failed: %s", jsonPath, err)
			continue
		}

		kernelMap := map[int]string{}
		label := langMap["_label"].(string)
		kernelLangs := langMap["_kernel"].(map[string]any)
		for k, v := range kernelLangs {
			num, convErr := strconv.Atoi(k)
			if nil != convErr {
				logging.LogErrorf("parse language configuration [%s] item [%d] failed: %s", p, num, convErr)
				continue
			}
			kernelMap[num] = v.(string)
		}
		kernelMap[-1] = label
		name := langName[:strings.LastIndex(langName, ".")]
		util.Langs[name] = kernelMap

		util.TimeLangs[name] = langMap["_time"].(map[string]any)
		util.TaskActionLangs[name] = langMap["_taskAction"].(map[string]any)
		util.TrayMenuLangs[name] = langMap["_trayMenu"].(map[string]any)
		util.AttrViewLangs[name] = langMap["_attrView"].(map[string]any)
	}
}

func loadLangs() (ret []*conf.Lang) {
	for name, langMap := range util.Langs {
		lang := &conf.Lang{Label: langMap[-1], Name: name}
		ret = append(ret, lang)
	}
	sort.Slice(ret, func(i, j int) bool {
		return ret[i].Name < ret[j].Name
	})
	return
}

var exitLock = sync.Mutex{}

// Close 退出内核进程.
//
// force：是否不执行同步过程而直接退出
//
// setCurrentWorkspace：是否将当前工作空间放到工作空间列表的最后一个
//
// execInstallPkg：是否执行新版本安装包
//
//	0：默认按照设置项 System.DownloadInstallPkg 检查并推送提示
//	1：不执行新版本安装
//	2：执行新版本安装
//
// 返回值 exitCode：
//
//	0：正常退出
//	1：同步执行失败
//	2：提示新安装包
//
// 当 force 为 true（强制退出）并且 execInstallPkg 为 0（默认检查更新）并且同步失败并且新版本安装版已经准备就绪时，执行新版本安装 https://github.com/siyuan-note/siyuan/issues/10288
func Close(force, setCurrentWorkspace bool, execInstallPkg int) (exitCode int) {
	exitLock.Lock()
	defer exitLock.Unlock()

	logging.LogInfof("exiting kernel [force=%v, setCurrentWorkspace=%v, execInstallPkg=%d]", force, setCurrentWorkspace, execInstallPkg)

	util.PushMsg(Conf.Language(95), 10000*60)
	FlushTxQueue()

	cancelPurge()

	if !force {
		if OnKernelPluginsStop != nil {
			OnKernelPluginsStop()
		}

		if Conf.Sync.Enabled && 3 != Conf.Sync.Mode &&
			((IsSubscriber() && conf.ProviderSiYuan == Conf.Sync.Provider) || conf.ProviderSiYuan != Conf.Sync.Provider) {
			syncData(true, false)
			if 0 != ExitSyncSucc {
				exitCode = 1
				return
			}
		}
	}

	// Close the user guide when exiting https://github.com/siyuan-note/siyuan/issues/10322
	closeUserGuide()

	// Improve indexing completeness when exiting https://github.com/siyuan-note/siyuan/issues/12039
	sql.FlushQueue()

	util.IsExiting.Store(true)
	waitSecondForExecInstallPkg := false
	newVerInstallPkgPath := getNewVerInstallPkgPath()
	if !skipNewVerInstallPkg() && "" != newVerInstallPkgPath {
		if 2 == execInstallPkg || (force && 0 == execInstallPkg) { // 执行新版本安装
			waitSecondForExecInstallPkg = true
			if gulu.OS.IsWindows() {
				util.PushMsg(Conf.Language(130), 1000*30)
			}
			go execNewVerInstallPkg(newVerInstallPkgPath)
		} else if 0 == execInstallPkg { // 新版本安装包已经准备就绪
			exitCode = 2
			logging.LogInfof("the new version install pkg is ready [%s], waiting for the user's next instruction", newVerInstallPkgPath)
			return
		}
	}

	Conf.Close()
	sql.CloseDatabase()
	closePushQueue()
	util.SaveAssetsTexts()
	clearWorkspaceTemp()
	clearCorruptedNotebooks()
	clearPortJSON()

	if setCurrentWorkspace {
		// 将当前工作空间放到工作空间列表的最后一个
		// Open the last workspace by default https://github.com/siyuan-note/siyuan/issues/10570
		workspacePaths, err := util.ReadWorkspacePaths()
		if err != nil {
			logging.LogErrorf("read workspace paths failed: %s", err)
		} else {
			workspacePaths = util.RemoveWorkspacePath(workspacePaths, util.WorkspaceDir)
			workspacePaths = append(workspacePaths, util.WorkspaceDir)
			util.WriteWorkspacePaths(workspacePaths)
		}
	}

	util.BroadcastByType("main", "exit", 0, "", nil)
	util.UnlockWorkspace()

	time.Sleep(500 * time.Millisecond)
	if waitSecondForExecInstallPkg {
		// 桌面端退出拉起更新安装时有时需要重启两次 https://github.com/siyuan-note/siyuan/issues/6544
		// 这里多等待一段时间，等待安装程序启动
		if gulu.OS.IsWindows() {
			time.Sleep(30 * time.Second)
		}
	}

	closeSyncWebSocket()

	go func() {
		time.Sleep(500 * time.Millisecond)
		logging.LogInfof("exited kernel")
		if nil != util.WebSocketServer {
			util.WebSocketServer.Close()
		}
		if nil != util.HttpServer {
			util.HttpServer.Close()
		}
		util.HttpServing = false

		if util.IsMobileContainer() {
			return
		}

		os.Exit(logging.ExitCodeOk)
	}()
	return
}

var customEmojis = sync.Map{}

func AddCustomEmoji(emojiName, imgSrc string) {
	customEmojis.Store(emojiName, imgSrc)
}

func ClearCustomEmojis() {
	customEmojis.Clear()
}

func NewLute() (ret *lute.Lute) {
	ret = util.NewLute()
	ret.SetCodeSyntaxHighlightLineNum(Conf.Editor.CodeSyntaxHighlightLineNum)
	ret.SetChineseParagraphBeginningSpace(Conf.Export.ParagraphBeginningSpace)
	ret.SetProtyleMarkNetImg(Conf.Editor.DisplayNetImgMark)
	ret.SetSpellcheck(Conf.Editor.Spellcheck)

	customEmojiMap := map[string]string{}
	customEmojis.Range(func(key, value any) bool {
		customEmojiMap[key.(string)] = value.(string)
		return true
	})
	ret.PutEmojis(customEmojiMap)
	return
}

func enableLuteInlineSyntax(luteEngine *lute.Lute) {
	luteEngine.SetInlineAsterisk(true)
	luteEngine.SetInlineUnderscore(true)
	luteEngine.SetSup(true)
	luteEngine.SetSub(true)
	luteEngine.SetTag(true)
	luteEngine.SetInlineMath(true)
	luteEngine.SetGFMStrikethrough(true)
}

func (conf *AppConf) Save() {
	if util.ReadOnly {
		return
	}

	Conf.m.Lock()
	defer Conf.m.Unlock()

	if nil != Conf.AI {
		Conf.AI.EncryptAPIKeys()
		defer Conf.AI.DecryptAPIKeys()
	}

	if nil != Conf.Secrets {
		Conf.Secrets.Encrypt()
		defer Conf.Secrets.Decrypt()
	}

	// safeMode 是纯运行时状态（由 --safe-mode 注入），不随 conf.json 持久化，避免跨启动残留。
	// 序列化写盘时临时清零，写完恢复内存值（供 getConf 等运行时读取）。
	safeMode := Conf.System.SafeMode
	Conf.System.SafeMode = false
	defer func() { Conf.System.SafeMode = safeMode }()

	newData, _ := gulu.JSON.MarshalIndentJSON(Conf, "", "  ")
	confPath := filepath.Join(util.ConfDir, "conf.json")
	oldData, err := filelock.ReadFile(confPath)
	if err != nil {
		conf.save0(newData)
		return
	}

	if bytes.Equal(newData, oldData) {
		return
	}

	conf.save0(newData)
}

func (conf *AppConf) save0(data []byte) {
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if err := filelock.WriteFile(confPath, data); err != nil {
		logging.LogErrorf("write conf [%s] failed: %s", confPath, err)
		util.ReportFileSysFatalError(err)
		return
	}
}

func (conf *AppConf) Close() {
	conf.Save()
}

func (conf *AppConf) Box(boxID string) *Box {
	for _, box := range conf.GetOpenedBoxes() {
		if box.ID == boxID {
			return box
		}
	}
	return nil
}

func (conf *AppConf) GetBox(boxID string) *Box {
	for _, box := range conf.GetBoxes() {
		if box.ID == boxID {
			return box
		}
	}
	return nil
}

func (conf *AppConf) BoxNames(boxIDs []string) (ret map[string]string) {
	ret = map[string]string{}

	boxes := conf.GetOpenedBoxes()
	for _, boxID := range boxIDs {
		for _, box := range boxes {
			if box.ID == boxID {
				ret[boxID] = box.Name
				break
			}
		}
	}
	return
}

func (conf *AppConf) GetBoxes() (ret []*Box) {
	ret = []*Box{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		id := notebook.ID
		name := notebook.Name
		closed := notebook.Closed
		box := &Box{ID: id, Name: name, Closed: closed}
		ret = append(ret, box)
	}
	return
}

func (conf *AppConf) GetOpenedBoxes() (ret []*Box) {
	ret = []*Box{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		if !notebook.Closed {
			ret = append(ret, notebook)
		}
	}
	return
}

func (conf *AppConf) GetClosedBoxes() (ret []*Box) {
	ret = []*Box{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		if notebook.Closed {
			ret = append(ret, notebook)
		}
	}
	return
}

func (conf *AppConf) Language(num int) (ret string) {
	ret = conf.language(num)
	ret = strings.ReplaceAll(ret, "${accountServer}", util.GetCloudAccountServer())
	return
}

func (conf *AppConf) language(num int) (ret string) {
	ret = util.Langs[conf.Lang][num]
	if "" != ret {
		return
	}
	ret = util.Langs["en"][num]
	return
}

func InitBoxes() {
	blockCount := treenode.CountBlocks()
	initialized := 0 < blockCount
	for _, box := range Conf.GetOpenedBoxes() {
		box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间

		if !initialized {
			indexBox(box.ID)
		}
	}

	logging.LogInfof("tree/block count [%d/%d]", treenode.CountTrees(), blockCount)
}

func IsSubscriber() bool {
	u := Conf.GetUser()
	return nil != u && (-1 == u.UserSiYuanProExpireTime || 0 < u.UserSiYuanProExpireTime) && 0 == u.UserSiYuanSubscriptionStatus
}

func IsPaidUser() bool {
	if IsSubscriber() {
		return true
	}

	u := Conf.GetUser()
	if nil == u {
		return false
	}
	return 1 == u.UserSiYuanOneTimePayStatus
}

const (
	MaskedUserData       = ""
	MaskedAccessAuthCode = "*******"
)

// GetMaskedConf 获取脱敏后的 Conf
func GetMaskedConf() (ret *AppConf, err error) {
	// 序列化时持锁，避免与 loadThemes/LoadIcons 等写操作并发导致 slice 在编码过程中被改写而 panic https://github.com/siyuan-note/siyuan/issues/16978
	Conf.m.Lock()
	data, err := gulu.JSON.MarshalJSON(Conf)
	Conf.m.Unlock()
	if err != nil {
		logging.LogErrorf("marshal conf failed: %s", err)
		return
	}
	ret = &AppConf{}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		logging.LogErrorf("unmarshal conf failed: %s", err)
		return
	}

	ret.UserData = MaskedUserData
	if "" != ret.AccessAuthCode {
		ret.AccessAuthCode = MaskedAccessAuthCode
	}
	return
}

// HideConfSecret 隐藏设置中的秘密信息
// REF: https://github.com/siyuan-note/siyuan/issues/11364
func HideConfSecret(c *AppConf) {
	c.AI = &conf.AI{}
	c.Api = &conf.API{}
	c.Flashcard = &conf.Flashcard{}
	c.ServerAddrs = []string{}
	c.Publish = &conf.Publish{}
	c.Repo = &conf.Repo{}
	c.Sync = &conf.Sync{}
	c.Secrets = &conf.Secrets{}
	c.Variables = &conf.Variables{}
	c.System.AppDir = ""
	c.System.ConfDir = ""
	c.System.DataDir = ""
	c.System.HomeDir = ""
	c.System.Name = ""
	c.System.NetworkProxy = &conf.NetworkProxy{}
}

func clearPortJSON() {
	pid := fmt.Sprintf("%d", os.Getpid())
	portJSON := filepath.Join(util.HomeDir, ".config", "siyuan", "port.json")
	pidPorts := map[string]string{}
	var data []byte
	var err error

	if gulu.File.IsExist(portJSON) {
		data, err = os.ReadFile(portJSON)
		if err != nil {
			logging.LogWarnf("read port.json failed: %s", err)
		} else {
			if err = gulu.JSON.UnmarshalJSON(data, &pidPorts); err != nil {
				logging.LogWarnf("unmarshal port.json failed: %s", err)
			}
		}
	}

	delete(pidPorts, pid)
	if data, err = gulu.JSON.MarshalIndentJSON(pidPorts, "", "  "); err != nil {
		logging.LogWarnf("marshal port.json failed: %s", err)
	} else {
		if err = os.WriteFile(portJSON, data, 0644); err != nil {
			logging.LogWarnf("write port.json failed: %s", err)
		}
	}
}

func clearCorruptedNotebooks() {
	// 数据同步时展开文档树操作可能导致数据丢失 https://github.com/siyuan-note/siyuan/issues/7129

	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
		return
	}
	for _, dir := range dirs {
		if util.IsReservedFilename(dir.Name()) {
			continue
		}

		if !dir.IsDir() {
			continue
		}

		if !ast.IsNodeIDPattern(dir.Name()) {
			continue
		}

		boxDirPath := filepath.Join(util.DataDir, dir.Name())
		boxConfPath := filepath.Join(boxDirPath, ".siyuan", "conf.json")
		if !filelock.IsExist(boxConfPath) {
			logging.LogWarnf("found a corrupted box [%s]", boxDirPath)
			continue
		}
	}
}

func clearWorkspaceTemp() {
	os.RemoveAll(filepath.Join(util.TempDir, "bazaar"))
	os.RemoveAll(filepath.Join(util.TempDir, "export"))
	os.RemoveAll(filepath.Join(util.TempDir, "import"))
	os.RemoveAll(filepath.Join(util.TempDir, "convert"))
	os.RemoveAll(filepath.Join(util.TempDir, "repo"))
	os.RemoveAll(filepath.Join(util.TempDir, "os"))
	os.RemoveAll(filepath.Join(util.TempDir, "base64"))
	os.RemoveAll(filepath.Join(util.TempDir, "ai"))

	// 退出时自动删除超过 7 天的安装包 https://github.com/siyuan-note/siyuan/issues/6128
	install := filepath.Join(util.TempDir, "install")
	if gulu.File.IsDir(install) {
		monthAgo := time.Now().Add(-time.Hour * 24 * 7)
		entries, err := os.ReadDir(install)
		if err != nil {
			logging.LogErrorf("read dir [%s] failed: %s", install, err)
		} else {
			for _, entry := range entries {
				info, _ := entry.Info()
				if nil != info && !info.IsDir() && info.ModTime().Before(monthAgo) {
					if err = os.RemoveAll(filepath.Join(install, entry.Name())); err != nil {
						logging.LogErrorf("remove old install pkg [%s] failed: %s", filepath.Join(install, entry.Name()), err)
					}
				}
			}
		}
	}

	tmps, err := filepath.Glob(filepath.Join(util.TempDir, "*.tmp"))
	if err != nil {
		logging.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); err != nil {
			logging.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			logging.LogInfof("removed temp file [%s]", tmp)
		}
	}

	tmps, err = filepath.Glob(filepath.Join(util.DataDir, ".siyuan", "*.tmp"))
	if err != nil {
		logging.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); err != nil {
			logging.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			logging.LogInfof("removed temp file [%s]", tmp)
		}
	}

	// 老版本遗留文件清理
	os.RemoveAll(filepath.Join(util.DataDir, "assets", ".siyuan", "assets.json"))
	os.RemoveAll(filepath.Join(util.DataDir, ".siyuan", "history"))
	os.RemoveAll(filepath.Join(util.WorkspaceDir, "backup"))
	os.RemoveAll(filepath.Join(util.WorkspaceDir, "sync"))
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree.msgpack")) // v2.7.2 前旧版的块树数据
	os.RemoveAll(filepath.Join(util.DataDir, "%"))                 // v3.0.6 生成的错误历史文件夹
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree"))         // v3.1.0 前旧版的块树数据

	// v3.7.0-dev 开发版遗留文件清理
	os.RemoveAll(filepath.Join(util.TempDir, "queue.wal"))
	os.RemoveAll(filepath.Join(util.TempDir, "queue.wal.lock"))
	os.RemoveAll(filepath.Join(util.DataDir, "storage", "ai", "agent", "todos"))

	logging.LogInfof("cleared workspace temp")
}

func closeUserGuide() {
	defer logging.Recover()

	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
		return
	}

	for _, dir := range dirs {
		if !IsUserGuide(dir.Name()) {
			continue
		}

		boxID := dir.Name()
		boxDirPath := filepath.Join(util.DataDir, boxID)
		boxConf := conf.NewBoxConf()
		boxConfPath := filepath.Join(boxDirPath, ".siyuan", "conf.json")
		if !filelock.IsExist(boxConfPath) {
			logging.LogWarnf("found a corrupted user guide box [%s]", boxDirPath)
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
			} else {
				logging.LogInfof("removed corrupted user guide box [%s]", boxDirPath)
			}
			continue
		}

		data, readErr := filelock.ReadFile(boxConfPath)
		if nil != readErr {
			logging.LogErrorf("read box conf [%s] failed: %s", boxConfPath, readErr)
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
			} else {
				logging.LogInfof("removed corrupted user guide box [%s]", boxDirPath)
			}
			continue
		}
		if readErr = gulu.JSON.UnmarshalJSON(data, boxConf); nil != readErr {
			logging.LogErrorf("parse box conf [%s] failed: %s", boxConfPath, readErr)
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
			} else {
				logging.LogInfof("removed corrupted user guide box [%s]", boxDirPath)
			}
			continue
		}

		if boxConf.Closed {
			continue
		}

		msgId := util.PushMsg(Conf.language(233), 30000)

		unindex(boxID)

		sql.FlushQueue()

		if removeErr := RemoveBox(boxID); nil == removeErr {
			evt := util.NewCmdResult("removeBox", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{
				"box": boxID,
			}
			util.PushEvent(evt)
		} else {
			logging.LogErrorf("close user guide box [%s] failed: %s", boxID, removeErr)
			util.PushClearMsg(msgId)
			continue
		}

		util.PushClearMsg(msgId)
		logging.LogInfof("closed user guide box [%s]", boxID)
	}
}

func init() {
	subscribeConfEvents()
}

func subscribeConfEvents() {
	eventbus.Subscribe(util.EvtConfPandocInitialized, func() {
		logging.LogInfof("pandoc initialized, set pandoc bin to [%s]", util.PandocBinPath)
		Conf.Export.PandocBin = util.PandocBinPath

		params := util.RemoveInvalid(Conf.Export.PandocParams)
		if !strings.Contains(params, "--reference-doc") && "" != util.PandocTemplatePath && !Conf.System.IsMicrosoftStore {
			params += " --reference-doc"
			params += " \"" + util.PandocTemplatePath + "\""
			Conf.Export.PandocParams = strings.TrimSpace(params)
		}

		logging.LogInfof("pandoc params set to [%s]", Conf.Export.PandocParams)
		logging.LogInfof("pandoc resources [%s, %s]", util.PandocTemplatePath, util.PandocColorFilterPath)
		Conf.Save()
	})
}
