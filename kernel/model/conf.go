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
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/Xuanwo/go-locale"
	"github.com/getsentry/sentry-go"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/text/language"
)

var Conf *AppConf

// AppConf 维护应用元数据，保存在 ~/.siyuan/conf.json。
type AppConf struct {
	LogLevel       string           `json:"logLevel"`       // 日志级别：Off, Trace, Debug, Info, Warn, Error, Fatal
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
	LocalIPs       []string         `json:"localIPs"`       // 本地 IP 列表
	AccessAuthCode string           `json:"accessAuthCode"` // 访问授权码
	System         *conf.System     `json:"system"`         // 系统配置
	Keymap         *conf.Keymap     `json:"keymap"`         // 快捷键配置
	Sync           *conf.Sync       `json:"sync"`           // 同步配置
	Search         *conf.Search     `json:"search"`         // 搜索配置
	Flashcard      *conf.Flashcard  `json:"flashcard"`      // 闪卡配置
	AI             *conf.AI         `json:"ai"`             // 人工智能配置
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

	m *sync.Mutex
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
	conf.m.Lock()
	defer conf.m.Unlock()
	return conf.User
}

func (conf *AppConf) SetUser(user *conf.User) {
	conf.m.Lock()
	defer conf.m.Unlock()
	conf.User = user
}

func InitConf() {
	initLang()

	Conf = &AppConf{LogLevel: "debug", m: &sync.Mutex{}}
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if gulu.File.IsExist(confPath) {
		if data, err := os.ReadFile(confPath); nil != err {
			logging.LogErrorf("load conf [%s] failed: %s", confPath, err)
		} else {
			if err = gulu.JSON.UnmarshalJSON(data, Conf); err != nil {
				logging.LogErrorf("parse conf [%s] failed: %s", confPath, err)
			} else {
				logging.LogInfof("loaded conf [%s]", confPath)
			}
		}
	}

	if "" != util.Lang {
		initialized := false
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
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
	} else {
		if "" == Conf.Lang {
			// 未指定外观语言时使用系统语言

			if userLang, err := locale.Detect(); nil == err {
				var supportLangs []language.Tag
				for lang := range util.Langs {
					if tag, err := language.Parse(lang); nil == err {
						supportLangs = append(supportLangs, tag)
					} else {
						logging.LogErrorf("load language [%s] failed: %s", lang, err)
					}
				}
				matcher := language.NewMatcher(supportLangs)
				lang, _, _ := matcher.Match(userLang)
				base, _ := lang.Base()
				region, _ := lang.Region()
				util.Lang = base.String() + "_" + region.String()
				Conf.Lang = util.Lang
				logging.LogInfof("initialized language [%s] based on device locale", Conf.Lang)
			} else {
				logging.LogDebugf("check device locale failed [%s], using default language [en_US]", err)
				util.Lang = "en_US"
				Conf.Lang = util.Lang
			}
		}
		util.Lang = Conf.Lang
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
		Conf.Lang = "en_US"
		util.Lang = Conf.Lang
	}
	Conf.Appearance.Lang = Conf.Lang
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
	Conf.FileTree.DocCreateSavePath = strings.TrimSpace(Conf.FileTree.DocCreateSavePath)
	util.UseSingleLineSave = Conf.FileTree.UseSingleLineSave

	util.CurrentCloudRegion = Conf.CloudRegion

	if nil == Conf.Tag {
		Conf.Tag = conf.NewTag()
	}

	if nil == Conf.Editor {
		Conf.Editor = conf.NewEditor()
	}
	if 1 > len(Conf.Editor.Emoji) {
		Conf.Editor.Emoji = []string{}
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
	if conf.MinDynamicLoadBlocks > Conf.Editor.DynamicLoadBlocks {
		Conf.Editor.DynamicLoadBlocks = conf.MinDynamicLoadBlocks
	}
	if conf.MaxDynamicLoadBlocks < Conf.Editor.DynamicLoadBlocks {
		Conf.Editor.DynamicLoadBlocks = conf.MaxDynamicLoadBlocks
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
	if 0 == Conf.Export.BlockRefMode || 1 == Conf.Export.BlockRefMode {
		// 废弃导出选项引用块转换为原始块和引述块 https://github.com/siyuan-note/siyuan/issues/3155
		Conf.Export.BlockRefMode = 4 // 改为脚注
	}
	if "" == Conf.Export.PandocBin {
		Conf.Export.PandocBin = util.PandocBinPath
	}

	if nil == Conf.Graph || nil == Conf.Graph.Local || nil == Conf.Graph.Global {
		Conf.Graph = conf.NewGraph()
	}

	if nil == Conf.System {
		Conf.System = conf.NewSystem()
		if util.ContainerIOS != util.Container {
			Conf.OpenHelp = true
		}
	} else {
		if 0 < semver.Compare("v"+util.Ver, "v"+Conf.System.KernelVersion) {
			logging.LogInfof("upgraded from version [%s] to [%s]", Conf.System.KernelVersion, util.Ver)
			Conf.ShowChangelog = true
		} else if 0 > semver.Compare("v"+util.Ver, "v"+Conf.System.KernelVersion) {
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

	if nil == Conf.Snippet {
		Conf.Snippet = conf.NewSnpt()
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
	if nil == Conf.Sync.S3 {
		Conf.Sync.S3 = &conf.S3{}
	}
	Conf.Sync.S3.Endpoint = util.NormalizeEndpoint(Conf.Sync.S3.Endpoint)
	Conf.Sync.S3.Timeout = util.NormalizeTimeout(Conf.Sync.S3.Timeout)
	if nil == Conf.Sync.WebDAV {
		Conf.Sync.WebDAV = &conf.WebDAV{}
	}
	Conf.Sync.WebDAV.Endpoint = util.NormalizeEndpoint(Conf.Sync.WebDAV.Endpoint)
	Conf.Sync.WebDAV.Timeout = util.NormalizeTimeout(Conf.Sync.WebDAV.Timeout)
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
		if nil == err {
			Conf.Repo.SyncIndexTiming = int64(val)
		}
	}
	if 12000 > Conf.Repo.SyncIndexTiming {
		Conf.Repo.SyncIndexTiming = 12 * 1000
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
	if "" == Conf.Flashcard.Weights || 17 != len(strings.Split(Conf.Flashcard.Weights, ",")) {
		Conf.Flashcard.Weights = conf.NewFlashcard().Weights
	}

	if nil == Conf.AI {
		Conf.AI = conf.NewAI()
	}
	if "" == Conf.AI.OpenAI.APIModel {
		Conf.AI.OpenAI.APIModel = openai.GPT3Dot5Turbo
	}
	if "" == Conf.AI.OpenAI.APIUserAgent {
		Conf.AI.OpenAI.APIUserAgent = util.UserAgent
	}
	if strings.HasPrefix(Conf.AI.OpenAI.APIUserAgent, "SiYuan/") {
		Conf.AI.OpenAI.APIUserAgent = util.UserAgent
	}
	if "" == Conf.AI.OpenAI.APIProvider {
		Conf.AI.OpenAI.APIProvider = "OpenAI"
	}
	if 0 > Conf.AI.OpenAI.APIMaxTokens {
		Conf.AI.OpenAI.APIMaxTokens = 0
	}
	if 0 >= Conf.AI.OpenAI.APITemperature || 2 < Conf.AI.OpenAI.APITemperature {
		Conf.AI.OpenAI.APITemperature = 1.0
	}
	if 1 > Conf.AI.OpenAI.APIMaxContexts || 64 < Conf.AI.OpenAI.APIMaxContexts {
		Conf.AI.OpenAI.APIMaxContexts = 7
	}

	if "" != Conf.AI.OpenAI.APIKey {
		logging.LogInfof("OpenAI API enabled\n"+
			"    userAgent=%s\n"+
			"    baseURL=%s\n"+
			"    timeout=%ds\n"+
			"    proxy=%s\n"+
			"    model=%s\n"+
			"    maxTokens=%d\n"+
			"    temperature=%.1f\n"+
			"    maxContexts=%d",
			Conf.AI.OpenAI.APIUserAgent,
			Conf.AI.OpenAI.APIBaseURL,
			Conf.AI.OpenAI.APITimeout,
			Conf.AI.OpenAI.APIProxy,
			Conf.AI.OpenAI.APIModel,
			Conf.AI.OpenAI.APIMaxTokens,
			Conf.AI.OpenAI.APITemperature,
			Conf.AI.OpenAI.APIMaxContexts)
	}

	Conf.ReadOnly = util.ReadOnly

	if "" != util.AccessAuthCode {
		Conf.AccessAuthCode = util.AccessAuthCode
	}

	Conf.LocalIPs = util.GetLocalIPs()

	if 1 == Conf.DataIndexState {
		// 上次未正常完成数据索引
		go func() {
			util.WaitForUILoaded()
			time.Sleep(2 * time.Second)
			if util.ContainerIOS == util.Container || util.ContainerAndroid == util.Container {
				util.PushMsg(Conf.language(245), 15000)
			} else {
				util.PushMsg(Conf.language(244), 15000)
			}
		}()
	}

	Conf.DataIndexState = 0

	Conf.Save()
	logging.SetLogLevel(Conf.LogLevel)

	if Conf.System.UploadErrLog {
		logging.LogInfof("user has enabled [Automatically upload error messages and diagnostic data]")
		sentry.Init(sentry.ClientOptions{
			Dsn:         "https://bdff135f14654ae58a054adeceb2c308@o1173696.ingest.sentry.io/6269178",
			Release:     util.Ver,
			Environment: util.Mode,
		})
	}

	if Conf.System.DisableGoogleAnalytics {
		logging.LogInfof("user has disabled [Google Analytics]")
	}

	util.SetNetworkProxy(Conf.System.NetworkProxy.String())

	go util.InitPandoc()
	go util.InitTesseract()
}

func initLang() {
	p := filepath.Join(util.WorkingDir, "appearance", "langs")
	dir, err := os.Open(p)
	if nil != err {
		logging.LogErrorf("open language configuration folder [%s] failed: %s", p, err)
		util.ReportFileSysFatalError(err)
		return
	}
	defer dir.Close()

	langNames, err := dir.Readdirnames(-1)
	if nil != err {
		logging.LogErrorf("list language configuration folder [%s] failed: %s", p, err)
		util.ReportFileSysFatalError(err)
		return
	}

	for _, langName := range langNames {
		jsonPath := filepath.Join(p, langName)
		data, err := os.ReadFile(jsonPath)
		if nil != err {
			logging.LogErrorf("read language configuration [%s] failed: %s", jsonPath, err)
			continue
		}
		langMap := map[string]interface{}{}
		if err := gulu.JSON.UnmarshalJSON(data, &langMap); nil != err {
			logging.LogErrorf("parse language configuration failed [%s] failed: %s", jsonPath, err)
			continue
		}

		kernelMap := map[int]string{}
		label := langMap["_label"].(string)
		kernelLangs := langMap["_kernel"].(map[string]interface{})
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

		util.TimeLangs[name] = langMap["_time"].(map[string]interface{})
		util.TaskActionLangs[name] = langMap["_taskAction"].(map[string]interface{})
		util.TrayMenuLangs[name] = langMap["_trayMenu"].(map[string]interface{})
		util.AttrViewLangs[name] = langMap["_attrView"].(map[string]interface{})
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
	WaitForWritingFiles()

	if !force {
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

	util.IsExiting.Store(true)
	waitSecondForExecInstallPkg := false
	if !skipNewVerInstallPkg() {
		if newVerInstallPkgPath := getNewVerInstallPkgPath(); "" != newVerInstallPkgPath {
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
	}

	Conf.Close()
	sql.CloseDatabase()
	util.SaveAssetsTexts()
	clearWorkspaceTemp()
	clearCorruptedNotebooks()
	clearPortJSON()

	if setCurrentWorkspace {
		// 将当前工作空间放到工作空间列表的最后一个
		// Open the last workspace by default https://github.com/siyuan-note/siyuan/issues/10570
		workspacePaths, err := util.ReadWorkspacePaths()
		if nil != err {
			logging.LogErrorf("read workspace paths failed: %s", err)
		} else {
			workspacePaths = gulu.Str.RemoveElem(workspacePaths, util.WorkspaceDir)
			workspacePaths = append(workspacePaths, util.WorkspaceDir)
			util.WriteWorkspacePaths(workspacePaths)
		}
	}

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
		util.WebSocketServer.Close()
		os.Exit(logging.ExitCodeOk)
	}()
	return
}

var CustomEmojis = sync.Map{}

func NewLute() (ret *lute.Lute) {
	ret = util.NewLute()
	ret.SetCodeSyntaxHighlightLineNum(Conf.Editor.CodeSyntaxHighlightLineNum)
	ret.SetChineseParagraphBeginningSpace(Conf.Export.ParagraphBeginningSpace)
	ret.SetProtyleMarkNetImg(Conf.Editor.DisplayNetImgMark)
	ret.SetSpellcheck(Conf.Editor.Spellcheck)

	customEmojiMap := map[string]string{}
	CustomEmojis.Range(func(key, value interface{}) bool {
		customEmojiMap[key.(string)] = value.(string)
		return true
	})
	ret.PutEmojis(customEmojiMap)
	return
}

func (conf *AppConf) Save() {
	if util.ReadOnly {
		return
	}

	Conf.m.Lock()
	defer Conf.m.Unlock()

	newData, _ := gulu.JSON.MarshalIndentJSON(Conf, "", "  ")
	confPath := filepath.Join(util.ConfDir, "conf.json")
	oldData, err := filelock.ReadFile(confPath)
	if nil != err {
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
	if err := filelock.WriteFile(confPath, data); nil != err {
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
	if nil != err {
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
	if nil != err {
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
	if nil != err {
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
	subscribeURL := util.GetCloudAccountServer() + "/subscribe/siyuan"
	ret = strings.ReplaceAll(ret, "${url}", subscribeURL)
	return
}

func (conf *AppConf) language(num int) (ret string) {
	ret = util.Langs[conf.Lang][num]
	if "" != ret {
		return
	}
	ret = util.Langs["en_US"][num]
	return
}

func InitBoxes() {
	initialized := 0 < treenode.CountBlocks()
	for _, box := range Conf.GetOpenedBoxes() {
		box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间

		if !initialized {
			index(box.ID)
		}
	}

	var dbSize string
	if dbFile, err := os.Stat(util.DBPath); nil == err {
		dbSize = humanize.BytesCustomCeil(uint64(dbFile.Size()), 2)
	}
	logging.LogInfof("database size [%s], tree/block count [%d/%d]", dbSize, treenode.CountTrees(), treenode.CountBlocks())
}

func IsSubscriber() bool {
	u := Conf.GetUser()
	return nil != u && (-1 == u.UserSiYuanProExpireTime || 0 < u.UserSiYuanProExpireTime) && 0 == u.UserSiYuanSubscriptionStatus
}

func IsPaidUser() bool {
	// S3/WebDAV data sync and backup are available for a fee https://github.com/siyuan-note/siyuan/issues/8780

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

func GetMaskedConf() (ret *AppConf, err error) {
	// 脱敏处理
	data, err := gulu.JSON.MarshalIndentJSON(Conf, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal conf failed: %s", err)
		return
	}
	ret = &AppConf{}
	if err = gulu.JSON.UnmarshalJSON(data, ret); nil != err {
		logging.LogErrorf("unmarshal conf failed: %s", err)
		return
	}

	ret.UserData = MaskedUserData
	if "" != ret.AccessAuthCode {
		ret.AccessAuthCode = MaskedAccessAuthCode
	}
	return
}

// REF: https://github.com/siyuan-note/siyuan/issues/11364
// HideConfSecret 隐藏设置中的秘密信息
func HideConfSecret(c *AppConf) {
	c.AI = &conf.AI{}
	c.Api = &conf.API{}
	c.Flashcard = &conf.Flashcard{}
	c.LocalIPs = []string{}
	c.Publish = &conf.Publish{}
	c.Repo = &conf.Repo{}
	c.Sync = &conf.Sync{}
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
		if nil != err {
			logging.LogWarnf("read port.json failed: %s", err)
		} else {
			if err = gulu.JSON.UnmarshalJSON(data, &pidPorts); nil != err {
				logging.LogWarnf("unmarshal port.json failed: %s", err)
			}
		}
	}

	delete(pidPorts, pid)
	if data, err = gulu.JSON.MarshalIndentJSON(pidPorts, "", "  "); nil != err {
		logging.LogWarnf("marshal port.json failed: %s", err)
	} else {
		if err = os.WriteFile(portJSON, data, 0644); nil != err {
			logging.LogWarnf("write port.json failed: %s", err)
		}
	}
}

func clearCorruptedNotebooks() {
	// 数据同步时展开文档树操作可能导致数据丢失 https://github.com/siyuan-note/siyuan/issues/7129

	dirs, err := os.ReadDir(util.DataDir)
	if nil != err {
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
	os.RemoveAll(filepath.Join(util.TempDir, "convert"))
	os.RemoveAll(filepath.Join(util.TempDir, "import"))
	os.RemoveAll(filepath.Join(util.TempDir, "repo"))
	os.RemoveAll(filepath.Join(util.TempDir, "os"))
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree.msgpack")) // v2.7.2 前旧版的块树数据
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree"))         // v3.1.0 前旧版的块树数据

	// 退出时自动删除超过 7 天的安装包 https://github.com/siyuan-note/siyuan/issues/6128
	install := filepath.Join(util.TempDir, "install")
	if gulu.File.IsDir(install) {
		monthAgo := time.Now().Add(-time.Hour * 24 * 7)
		entries, err := os.ReadDir(install)
		if nil != err {
			logging.LogErrorf("read dir [%s] failed: %s", install, err)
		} else {
			for _, entry := range entries {
				info, _ := entry.Info()
				if nil != info && !info.IsDir() && info.ModTime().Before(monthAgo) {
					if err = os.RemoveAll(filepath.Join(install, entry.Name())); nil != err {
						logging.LogErrorf("remove old install pkg [%s] failed: %s", filepath.Join(install, entry.Name()), err)
					}
				}
			}
		}
	}

	tmps, err := filepath.Glob(filepath.Join(util.TempDir, "*.tmp"))
	if nil != err {
		logging.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); nil != err {
			logging.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			logging.LogInfof("removed temp file [%s]", tmp)
		}
	}

	tmps, err = filepath.Glob(filepath.Join(util.DataDir, ".siyuan", "*.tmp"))
	if nil != err {
		logging.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); nil != err {
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
	os.RemoveAll(filepath.Join(util.DataDir, "%")) // v3.0.6 生成的错误历史文件夹

	logging.LogInfof("cleared workspace temp")
}

func closeUserGuide() {
	defer logging.Recover()

	dirs, err := os.ReadDir(util.DataDir)
	if nil != err {
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
		evt := util.NewCmdResult("unmount", 0, util.PushModeBroadcast)
		evt.Data = map[string]interface{}{
			"box": boxID,
		}
		util.PushEvent(evt)

		unindex(boxID)

		if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
			logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
		}

		sql.WaitForWritingDatabase()

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
		Conf.Save()
	})
}
