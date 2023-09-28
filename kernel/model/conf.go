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

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/Xuanwo/go-locale"
	"github.com/dustin/go-humanize"
	"github.com/getsentry/sentry-go"
	"github.com/sashabaranov/go-openai"
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
	LogLevel       string           `json:"logLevel"`       // 日志级别：Off, Trace, Debug, Info, Warn, Error, Fatal
	Appearance     *conf.Appearance `json:"appearance"`     // 外观
	Langs          []*conf.Lang     `json:"langs"`          // 界面语言列表
	Lang           string           `json:"lang"`           // 选择的界面语言，同 Appearance.Lang
	FileTree       *conf.FileTree   `json:"fileTree"`       // 文档面板
	Tag            *conf.Tag        `json:"tag"`            // 标签面板
	Editor         *conf.Editor     `json:"editor"`         // 编辑器配置
	Export         *conf.Export     `json:"export"`         // 导出配置
	Graph          *conf.Graph      `json:"graph"`          // 关系图配置
	UILayout       *conf.UILayout   `json:"uiLayout"`       // 界面布局，v2.8.0 后这个字段不再使用
	UserData       string           `json:"userData"`       // 社区用户信息，对 User 加密存储
	User           *conf.User       `json:"-"`              // 社区用户内存结构，不持久化
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
	OpenHelp       bool             `json:"openHelp"`       // 启动后是否需要打开用户指南
	ShowChangelog  bool             `json:"showChangelog"`  // 是否显示版本更新日志
	CloudRegion    int              `json:"cloudRegion"`    // 云端区域，0：中国大陆，1：北美
}

func InitConf() {
	initLang()

	windowStateConf := filepath.Join(util.ConfDir, "windowState.json")
	if !gulu.File.IsExist(windowStateConf) {
		if err := gulu.File.WriteFileSafer(windowStateConf, []byte("{}"), 0644); nil != err {
			logging.LogErrorf("create [windowState.json] failed: %s", err)
		}
	}

	Conf = &AppConf{LogLevel: "debug"}
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if gulu.File.IsExist(confPath) {
		data, err := os.ReadFile(confPath)
		if nil != err {
			logging.LogErrorf("load conf [%s] failed: %s", confPath, err)
		}
		err = gulu.JSON.UnmarshalJSON(data, Conf)
		if err != nil {
			logging.LogErrorf("parse conf [%s] failed: %s", confPath, err)
		}
	}

	if "" != util.Lang {
		Conf.Lang = util.Lang
		logging.LogInfof("initialized the specified language [%s]", util.Lang)
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
	if "../" == Conf.FileTree.DocCreateSavePath {
		Conf.FileTree.DocCreateSavePath = "../Untitled"
	}
	for strings.HasSuffix(Conf.FileTree.DocCreateSavePath, "/") {
		Conf.FileTree.DocCreateSavePath = strings.TrimSuffix(Conf.FileTree.DocCreateSavePath, "/")
		Conf.FileTree.DocCreateSavePath = strings.TrimSpace(Conf.FileTree.DocCreateSavePath)
	}
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
	if 1 > Conf.Editor.BlockRefDynamicAnchorTextMaxLen {
		Conf.Editor.BlockRefDynamicAnchorTextMaxLen = 64
	}
	if 5120 < Conf.Editor.BlockRefDynamicAnchorTextMaxLen {
		Conf.Editor.BlockRefDynamicAnchorTextMaxLen = 5120
	}
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
	if 9 > Conf.Editor.FontSize || 72 < Conf.Editor.FontSize {
		Conf.Editor.FontSize = 16
	}
	if "" == Conf.Editor.PlantUMLServePath {
		Conf.Editor.PlantUMLServePath = "https://www.plantuml.com/plantuml/svg/~1"
	}

	if nil == Conf.Graph || nil == Conf.Graph.Local || nil == Conf.Graph.Global {
		Conf.Graph = conf.NewGraph()
	}
	if nil == Conf.System {
		Conf.System = conf.NewSystem()
		Conf.OpenHelp = true
	} else {
		if 0 < semver.Compare("v"+util.Ver, "v"+Conf.System.KernelVersion) {
			logging.LogInfof("upgraded from version [%s] to [%s]", Conf.System.KernelVersion, util.Ver)
			Conf.ShowChangelog = true
		} else if 0 > semver.Compare("v"+util.Ver, "v"+Conf.System.KernelVersion) {
			logging.LogInfof("downgraded from version [%s] to [%s]", Conf.System.KernelVersion, util.Ver)
		}

		Conf.System.KernelVersion = util.Ver
		Conf.System.IsInsider = util.IsInsider
		task.AppendTask(task.UpgradeUserGuide, upgradeUserGuide)
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
		Conf.User = loadUserFromConf()
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

	if nil == Conf.Repo {
		Conf.Repo = conf.NewRepo()
	}

	if 1440 < Conf.Editor.GenerateHistoryInterval {
		Conf.Editor.GenerateHistoryInterval = 1440
	}
	if 1 > Conf.Editor.HistoryRetentionDays {
		Conf.Editor.HistoryRetentionDays = 7
	}
	if 48 > Conf.Editor.DynamicLoadBlocks {
		Conf.Editor.DynamicLoadBlocks = 48
	}
	if 1024 < Conf.Editor.DynamicLoadBlocks {
		Conf.Editor.DynamicLoadBlocks = 1024
	}
	if 0 > Conf.Editor.BacklinkExpandCount {
		Conf.Editor.BacklinkExpandCount = 0
	}
	if 0 > Conf.Editor.BackmentionExpandCount {
		Conf.Editor.BackmentionExpandCount = 0
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

	if "" != Conf.AI.OpenAI.APIKey {
		logging.LogInfof("OpenAI API enabled\n"+
			"    baseURL=%s\n"+
			"    timeout=%ds\n"+
			"    proxy=%s\n"+
			"    model=%s\n"+
			"    maxTokens=%d",
			Conf.AI.OpenAI.APIBaseURL, Conf.AI.OpenAI.APITimeout, Conf.AI.OpenAI.APIProxy, Conf.AI.OpenAI.APIModel, Conf.AI.OpenAI.APIMaxTokens)
	}

	Conf.ReadOnly = util.ReadOnly

	if "" != util.AccessAuthCode {
		Conf.AccessAuthCode = util.AccessAuthCode
	}

	Conf.LocalIPs = util.GetLocalIPs()

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
// execInstallPkg：是否执行新版本安装包
// 0：默认按照设置项 System.DownloadInstallPkg 检查并推送提示
// 1：不执行新版本安装
// 2：执行新版本安装
func Close(force bool, execInstallPkg int) (exitCode int) {
	exitLock.Lock()
	defer exitLock.Unlock()
	util.IsExiting = true

	logging.LogInfof("exiting kernel [force=%v, execInstallPkg=%d]", force, execInstallPkg)
	util.PushMsg(Conf.Language(95), 10000*60)
	WaitForWritingFiles()

	if !force {
		if Conf.Sync.Enabled && 3 != Conf.Sync.Mode &&
			((IsSubscriber() && conf.ProviderSiYuan == Conf.Sync.Provider) || conf.ProviderSiYuan != Conf.Sync.Provider) {
			syncData(true, false, false)
			if 0 != ExitSyncSucc {
				exitCode = 1
				return
			}
		}
	}

	waitSecondForExecInstallPkg := false
	if !skipNewVerInstallPkg() {
		newVerInstallPkgPath := getNewVerInstallPkgPath()
		if "" != newVerInstallPkgPath {
			if 0 == execInstallPkg { // 新版本安装包已经准备就绪
				exitCode = 2
				logging.LogInfof("the new version install pkg is ready [%s], waiting for the user's next instruction", newVerInstallPkgPath)
				return
			} else if 2 == execInstallPkg { // 执行新版本安装
				waitSecondForExecInstallPkg = true
				go execNewVerInstallPkg(newVerInstallPkgPath)
			}
		}
	}

	Conf.Close()
	sql.CloseDatabase()
	treenode.SaveBlockTree(false)
	SaveAssetsTexts()
	clearWorkspaceTemp()
	clearCorruptedNotebooks()
	clearPortJSON()
	util.UnlockWorkspace()

	time.Sleep(500 * time.Millisecond)
	if waitSecondForExecInstallPkg {
		util.PushMsg(Conf.Language(130), 1000*5)
		// 桌面端退出拉起更新安装时有时需要重启两次 https://github.com/siyuan-note/siyuan/issues/6544
		// 这里多等待一段时间，等待安装程序启动
		time.Sleep(4 * time.Second)
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

var confSaveLock = sync.Mutex{}

func (conf *AppConf) Save() {
	if util.ReadOnly {
		return
	}

	confSaveLock.Lock()
	defer confSaveLock.Unlock()

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
	initialized := false
	if 1 > treenode.CountBlocks() {
		if gulu.File.IsExist(util.BlockTreePath) {
			util.IncBootProgress(20, Conf.Language(91))
			go func() {
				for i := 0; i < 40; i++ {
					util.RandomSleep(50, 100)
					util.IncBootProgress(1, Conf.Language(91))
				}
			}()

			treenode.InitBlockTree(false)
			initialized = true
		}
	} else { // 大于 1 的话说明在同步阶段已经加载过了
		initialized = true
	}

	for _, box := range Conf.GetOpenedBoxes() {
		box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间

		if !initialized {
			index(box.ID)
		}
	}

	if !initialized {
		treenode.SaveBlockTree(true)
	}

	var dbSize string
	if dbFile, err := os.Stat(util.DBPath); nil == err {
		dbSize = humanize.Bytes(uint64(dbFile.Size()))
	}
	logging.LogInfof("database size [%s], tree/block count [%d/%d]", dbSize, treenode.CountTrees(), treenode.CountBlocks())
}

func IsSubscriber() bool {
	return nil != Conf.User && (-1 == Conf.User.UserSiYuanProExpireTime || 0 < Conf.User.UserSiYuanProExpireTime) && 0 == Conf.User.UserSiYuanSubscriptionStatus
}

func IsPaidUser() bool {
	if IsSubscriber() {
		return true
	}
	return nil != Conf.User // Sign in to use S3/WebDAV data sync https://github.com/siyuan-note/siyuan/issues/8779
	// TODO S3/WebDAV data sync and backup are available for a fee https://github.com/siyuan-note/siyuan/issues/8780
	// return nil != Conf.User && 1 == Conf.User.UserSiYuanOneTimePayStatus
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
		if !gulu.File.IsExist(boxConfPath) {
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
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree.msgpack")) // v2.7.2 前旧版的块数数据

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

	logging.LogInfof("cleared workspace temp")
}

func upgradeUserGuide() {
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
		if !gulu.File.IsExist(boxConfPath) {
			logging.LogWarnf("found a corrupted box [%s]", boxDirPath)
			continue
		}

		data, readErr := filelock.ReadFile(boxConfPath)
		if nil != readErr {
			logging.LogErrorf("read box conf [%s] failed: %s", boxConfPath, readErr)
			continue
		}
		if readErr = gulu.JSON.UnmarshalJSON(data, boxConf); nil != readErr {
			logging.LogErrorf("parse box conf [%s] failed: %s", boxConfPath, readErr)
			continue
		}

		if boxConf.Closed {
			continue
		}

		unindex(boxID)

		if err = filelock.Remove(boxDirPath); nil != err {
			return
		}
		p := filepath.Join(util.WorkingDir, "guide", boxID)
		if err = filelock.Copy(p, boxDirPath); nil != err {
			return
		}

		index(boxID)
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
