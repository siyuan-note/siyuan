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
	"crypto/sha256"
	"errors"
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
	humanize "github.com/dustin/go-humanize"
	"github.com/getsentry/sentry-go"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
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
	E2EEPasswd     string           `json:"e2eePasswd"`     // 端到端加密密码，用于备份和同步
	E2EEPasswdMode int              `json:"e2eePasswdMode"` // 端到端加密密码生成方式，0：自动，1：自定义
	System         *conf.System     `json:"system"`         // 系统
	Keymap         *conf.Keymap     `json:"keymap"`         // 快捷键
	Backup         *conf.Backup     `json:"backup"`         // 备份配置
	Sync           *conf.Sync       `json:"sync"`           // 同步配置
	Search         *conf.Search     `json:"search"`         // 搜索配置
	Stat           *conf.Stat       `json:"stat"`           // 统计
	Api            *conf.API        `json:"api"`            // API
	Newbie         bool             `json:"newbie"`         // 是否是安装后第一次启动
}

func InitConf() {
	initLang()

	windowStateConf := filepath.Join(util.ConfDir, "windowState.json")
	if !gulu.File.IsExist(windowStateConf) {
		if err := gulu.File.WriteFileSafer(windowStateConf, []byte("{}"), 0644); nil != err {
			util.LogErrorf("create [windowState.json] failed: %s", err)
		}
	}

	Conf = &AppConf{LogLevel: "debug", Lang: util.Lang}
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if gulu.File.IsExist(confPath) {
		data, err := os.ReadFile(confPath)
		if nil != err {
			util.LogErrorf("load conf [%s] failed: %s", confPath, err)
		}
		err = gulu.JSON.UnmarshalJSON(data, Conf)
		if err != nil {
			util.LogErrorf("parse conf [%s] failed: %s", confPath, err)
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
	if "" != Conf.System.NetworkProxy.Scheme {
		util.LogInfof("using network proxy [%s]", Conf.System.NetworkProxy.String())
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
	util.UserAgent = util.UserAgent + " " + util.Container
	Conf.System.OS = runtime.GOOS
	Conf.Newbie = util.IsNewbie

	if "" != Conf.UserData {
		Conf.User = loadUserFromConf()
	}
	if nil == Conf.Account {
		Conf.Account = conf.NewAccount()
	}

	if nil == Conf.Backup {
		Conf.Backup = conf.NewBackup()
	}
	if !gulu.File.IsExist(Conf.Backup.GetSaveDir()) {
		if err := os.MkdirAll(Conf.Backup.GetSaveDir(), 0755); nil != err {
			util.LogErrorf("create backup dir [%s] failed: %s", Conf.Backup.GetSaveDir(), err)
		}
	}

	if nil == Conf.Sync {
		Conf.Sync = conf.NewSync()
	}
	if !gulu.File.IsExist(Conf.Sync.GetSaveDir()) {
		if err := os.MkdirAll(Conf.Sync.GetSaveDir(), 0755); nil != err {
			util.LogErrorf("create sync dir [%s] failed: %s", Conf.Sync.GetSaveDir(), err)
		}
	}
	if 0 == Conf.Sync.Mode {
		Conf.Sync.Mode = 1
	}

	if nil == Conf.Api {
		Conf.Api = conf.NewAPI()
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

	Conf.E2EEPasswdMode = 0
	if !isBuiltInE2EEPasswd() {
		Conf.E2EEPasswdMode = 1
	}

	Conf.LocalIPs = util.GetLocalIPs()

	Conf.Save()
	util.SetLogLevel(Conf.LogLevel)

	if Conf.System.UploadErrLog {
		util.LogInfof("user has enabled [Automatically upload error messages and diagnostic data]")
		sentry.Init(sentry.ClientOptions{
			Dsn:         "https://bdff135f14654ae58a054adeceb2c308@o1173696.ingest.sentry.io/6269178",
			Release:     util.Ver,
			Environment: util.Mode,
		})
	}
}

var langs = map[string]map[int]string{}
var timeLangs = map[string]map[string]interface{}{}

func initLang() {
	p := filepath.Join(util.WorkingDir, "appearance", "langs")
	dir, err := os.Open(p)
	if nil != err {
		util.LogFatalf("open language configuration folder [%s] failed: %s", p, err)
	}
	defer dir.Close()

	langNames, err := dir.Readdirnames(-1)
	if nil != err {
		util.LogFatalf("list language configuration folder [%s] failed: %s", p, err)
	}

	for _, langName := range langNames {
		jsonPath := filepath.Join(p, langName)
		data, err := os.ReadFile(jsonPath)
		if nil != err {
			util.LogErrorf("read language configuration [%s] failed: %s", jsonPath, err)
			continue
		}
		langMap := map[string]interface{}{}
		if err := gulu.JSON.UnmarshalJSON(data, &langMap); nil != err {
			util.LogErrorf("parse language configuration failed [%s] failed: %s", jsonPath, err)
			continue
		}

		kernelMap := map[int]string{}
		label := langMap["_label"].(string)
		kernelLangs := langMap["_kernel"].(map[string]interface{})
		for k, v := range kernelLangs {
			num, err := strconv.Atoi(k)
			if nil != err {
				util.LogErrorf("parse language configuration [%s] item [%d] failed [%s] failed: %s", p, num, err)
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

func Close(force bool) (err error) {
	exitLock.Lock()
	defer exitLock.Unlock()

	treenode.CloseBlockTree()
	util.PushMsg(Conf.Language(95), 10000*60)
	WaitForWritingFiles()
	if !force {
		SyncData(false, true, false)
		if 0 != ExitSyncSucc {
			err = errors.New(Conf.Language(96))
			return
		}
	}

	//util.UIProcessIDs.Range(func(key, _ interface{}) bool {
	//	pid := key.(string)
	//	util.Kill(pid)
	//	return true
	//})

	Conf.Close()
	sql.CloseDatabase()
	util.WebSocketServer.Close()
	clearWorkspaceTemp()
	util.LogInfof("exited kernel")
	go func() {
		time.Sleep(500 * time.Millisecond)
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
	oldData, err := filesys.NoLockFileRead(confPath)
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
	if err := filesys.LockFileWrite(confPath, data); nil != err {
		util.LogFatalf("write conf [%s] failed: %s", confPath, err)
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

func (conf *AppConf) Language(num int) string {
	return langs[conf.Lang][num]
}

func InitBoxes() {
	initialized := false
	blockCount := 0
	if 1 > len(treenode.GetBlockTrees()) {
		if gulu.File.IsExist(util.BlockTreePath) {
			util.IncBootProgress(30, "Reading block trees...")
			go func() {
				for i := 0; i < 40; i++ {
					util.RandomSleep(100, 200)
					util.IncBootProgress(1, "Reading block trees...")
				}
			}()
			if err := treenode.ReadBlockTree(); nil == err {
				initialized = true
			} else {
				if err = os.RemoveAll(util.BlockTreePath); nil != err {
					util.LogErrorf("remove block tree [%s] failed: %s", util.BlockTreePath, err)
				}
			}
		}
	} else { // 大于 1 的话说明在同步阶段已经加载过了
		initialized = true
	}

	for _, box := range Conf.GetOpenedBoxes() {
		box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间
		if !initialized {
			box.BootIndex()
		}

		ListDocTree(box.ID, "/", Conf.FileTree.Sort) // 缓存根一级的文档树展开
	}

	if !initialized {
		treenode.SaveBlockTree()
	}

	blocktrees := treenode.GetBlockTrees()
	blockCount = len(blocktrees)

	var dbSize string
	if dbFile, err := os.Stat(util.DBPath); nil == err {
		dbSize = humanize.Bytes(uint64(dbFile.Size()))
	}
	util.LogInfof("database size [%s], block count [%d]", dbSize, blockCount)
}

func IsSubscriber() bool {
	return nil != Conf.User && (-1 == Conf.User.UserSiYuanProExpireTime || 0 < Conf.User.UserSiYuanProExpireTime) && 0 == Conf.User.UserSiYuanSubscriptionStatus
}

func isBuiltInE2EEPasswd() bool {
	if nil == Conf || nil == Conf.User || "" == Conf.E2EEPasswd {
		return true
	}

	pwd := GetBuiltInE2EEPasswd()
	return Conf.E2EEPasswd == util.AESEncrypt(pwd)
}

func GetBuiltInE2EEPasswd() (ret string) {
	part1 := Conf.User.UserId[:7]
	part2 := Conf.User.UserId[7:]
	ret = part2 + part1
	ret = fmt.Sprintf("%x", sha256.Sum256([]byte(ret)))[:7]
	return
}

func clearWorkspaceTemp() {
	os.RemoveAll(filepath.Join(util.TempDir, "bazaar"))
	os.RemoveAll(filepath.Join(util.TempDir, "export"))
	os.RemoveAll(filepath.Join(util.TempDir, "import"))

	tmps, err := filepath.Glob(filepath.Join(util.TempDir, "*.tmp"))
	if nil != err {
		util.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); nil != err {
			util.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			util.LogInfof("removed temp file [%s]", tmp)
		}
	}

	tmps, err = filepath.Glob(filepath.Join(util.DataDir, ".siyuan", "*.tmp"))
	if nil != err {
		util.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); nil != err {
			util.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			util.LogInfof("removed temp file [%s]", tmp)
		}
	}
}
