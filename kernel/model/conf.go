// SiYuan - Build Your Eternal Digital Garden
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
	"github.com/Xuanwo/go-locale"
	humanize "github.com/dustin/go-humanize"
	"github.com/getsentry/sentry-go"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
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
	UILayout       *conf.UILayout   `json:"uiLayout"`       // 界面布局
	UserData       string           `json:"userData"`       // 社区用户信息，对 User 加密存储
	User           *conf.User       `json:"-"`              // 社区用户内存结构，不持久化
	Account        *conf.Account    `json:"account"`        // 帐号配置
	ReadOnly       bool             `json:"readonly"`       // 是否是只读
	LocalIPs       []string         `json:"localIPs"`       // 本地 IP 列表
	AccessAuthCode string           `json:"accessAuthCode"` // 访问授权码
	System         *conf.System     `json:"system"`         // 系统
	Keymap         *conf.Keymap     `json:"keymap"`         // 快捷键
	Sync           *conf.Sync       `json:"sync"`           // 同步配置
	Search         *conf.Search     `json:"search"`         // 搜索配置
	Stat           *conf.Stat       `json:"stat"`           // 统计
	Api            *conf.API        `json:"api"`            // API
	Repo           *conf.Repo       `json:"repo"`           // 数据仓库
	Newbie         bool             `json:"newbie"`         // 是否是安装后第一次启动
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
				for lang := range langs {
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
	} else {
		Conf.System.KernelVersion = util.Ver
		Conf.System.IsInsider = util.IsInsider
	}
	if nil == Conf.System.NetworkProxy {
		Conf.System.NetworkProxy = &conf.NetworkProxy{}
	}
	if "" == Conf.System.ID {
		Conf.System.ID = util.GetDeviceID()
	}
	if "std" == util.Container {
		Conf.System.ID = util.GetDeviceID()
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
	Conf.Newbie = util.IsNewbie

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

	if nil == Conf.Api {
		Conf.Api = conf.NewAPI()
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

	if nil == Conf.Search {
		Conf.Search = conf.NewSearch()
	}

	if nil == Conf.Stat {
		Conf.Stat = conf.NewStat()
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

	util.SetNetworkProxy(Conf.System.NetworkProxy.String())
}

var langs = map[string]map[int]string{}
var timeLangs = map[string]map[string]interface{}{}

func initLang() {
	p := filepath.Join(util.WorkingDir, "appearance", "langs")
	dir, err := os.Open(p)
	if nil != err {
		logging.LogFatalf("open language configuration folder [%s] failed: %s", p, err)
	}
	defer dir.Close()

	langNames, err := dir.Readdirnames(-1)
	if nil != err {
		logging.LogFatalf("list language configuration folder [%s] failed: %s", p, err)
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
			num, err := strconv.Atoi(k)
			if nil != err {
				logging.LogErrorf("parse language configuration [%s] item [%d] failed [%s] failed: %s", p, num, err)
				continue
			}
			kernelMap[num] = v.(string)
		}
		kernelMap[-1] = label
		name := langName[:strings.LastIndex(langName, ".")]
		langs[name] = kernelMap

		timeLangs[name] = langMap["_time"].(map[string]interface{})
	}
}

func loadLangs() (ret []*conf.Lang) {
	for name, langMap := range langs {
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
//
//		0：默认按照设置项 System.DownloadInstallPkg 检查并推送提示
//	 1：不执行新版本安装
//	 2：执行新版本安装
func Close(force bool, execInstallPkg int) (exitCode int) {
	exitLock.Lock()
	defer exitLock.Unlock()

	logging.LogInfof("exiting kernel [force=%v, execInstallPkg=%d]", force, execInstallPkg)

	treenode.CloseBlockTree()
	util.PushMsg(Conf.Language(95), 10000*60)
	WaitForWritingFiles()
	if !force {
		SyncData(false, true, false)
		if 0 != ExitSyncSucc {
			exitCode = 1
			return
		}
	}

	//util.UIProcessIDs.Range(func(key, _ interface{}) bool {
	//	pid := key.(string)
	//	util.Kill(pid)
	//	return true
	//})

	if !skipNewVerInstallPkg() {
		newVerInstallPkgPath := getNewVerInstallPkgPath()
		if "" != newVerInstallPkgPath {
			if 0 == execInstallPkg { // 新版本安装包已经准备就绪
				exitCode = 2
				logging.LogInfof("the new version install pkg is ready [%s], waiting for the user's next instruction", newVerInstallPkgPath)
				return
			} else if 2 == execInstallPkg { // 执行新版本安装
				go execNewVerInstallPkg(newVerInstallPkgPath)
			}
		}
	}

	Conf.Close()
	sql.CloseDatabase()
	clearWorkspaceTemp()

	go func() {
		time.Sleep(500 * time.Millisecond)
		logging.LogInfof("exited kernel")
		util.WebSocketServer.Close()
		os.Exit(util.ExitCodeOk)
	}()
	return
}

var CustomEmojis = sync.Map{}

func NewLute() (ret *lute.Lute) {
	ret = util.NewLute()
	ret.SetCodeSyntaxHighlightLineNum(Conf.Editor.CodeSyntaxHighlightLineNum)
	ret.SetChineseParagraphBeginningSpace(Conf.Export.ParagraphBeginningSpace)
	ret.SetProtyleMarkNetImg(Conf.Editor.DisplayNetImgMark)

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
	confSaveLock.Lock()
	confSaveLock.Unlock()

	newData, _ := gulu.JSON.MarshalIndentJSON(Conf, "", "  ")
	confPath := filepath.Join(util.ConfDir, "conf.json")
	oldData, err := filelock.NoLockFileRead(confPath)
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
	if err := filelock.NoLockFileWrite(confPath, data); nil != err {
		logging.LogFatalf("write conf [%s] failed: %s", confPath, err)
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
	ret = langs[conf.Lang][num]
	if "" != ret {
		return
	}
	ret = langs["en_US"][num]
	return
}

func InitBoxes() {
	initialized := false
	if 1 > treenode.CountBlocks() {
		if gulu.File.IsExist(util.BlockTreePath) {
			util.IncBootProgress(20, "Reading block trees...")
			go func() {
				for i := 0; i < 40; i++ {
					util.RandomSleep(50, 100)
					util.IncBootProgress(1, "Reading block trees...")
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
			box.Index(true)
		}

		ListDocTree(box.ID, "/", Conf.FileTree.Sort) // 缓存根一级的文档树展开
	}

	if !initialized {
		treenode.SaveBlockTree()
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

func clearWorkspaceTemp() {
	os.RemoveAll(filepath.Join(util.TempDir, "bazaar"))
	os.RemoveAll(filepath.Join(util.TempDir, "export"))
	os.RemoveAll(filepath.Join(util.TempDir, "import"))
	os.RemoveAll(filepath.Join(util.TempDir, "repo"))
	os.RemoveAll(filepath.Join(util.TempDir, "os"))

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

	logging.LogInfof("cleared workspace temp")
}
