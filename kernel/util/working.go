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

package util

import (
	"bytes"
	"flag"
	"log"
	"math/rand"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	figure "github.com/common-nighthawk/go-figure"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

// var Mode = "dev"
var Mode = "prod"

const (
	Ver       = "2.6.2"
	IsInsider = false
)

var (
	bootProgress float64 // 启动进度，从 0 到 100
	bootDetails  string  // 启动细节描述
	HttpServing  = false // 是否 HTTP 伺服已经可用
)

func Boot() {
	IncBootProgress(3, "Booting...")
	rand.Seed(time.Now().UTC().UnixNano())
	initMime()
	initHttpClient()

	workspacePath := flag.String("workspace", "", "dir path of the workspace, default to ~/Documents/SiYuan/")
	wdPath := flag.String("wd", WorkingDir, "working directory of SiYuan")
	port := flag.String("port", "0", "port of the HTTP server")
	readOnly := flag.String("readonly", "false", "read-only mode")
	accessAuthCode := flag.String("accessAuthCode", "", "access auth code")
	ssl := flag.Bool("ssl", false, "for https and wss")
	lang := flag.String("lang", "", "zh_CN/zh_CHT/en_US/fr_FR/es_ES")
	mode := flag.String("mode", "prod", "dev/prod")
	flag.Parse()

	if "" != *wdPath {
		WorkingDir = *wdPath
	}
	if "" != *lang {
		Lang = *lang
	}
	Mode = *mode
	ServerPort = *port
	ReadOnly, _ = strconv.ParseBool(*readOnly)
	AccessAuthCode = *accessAuthCode
	Container = ContainerStd
	if isRunningInDockerContainer() {
		Container = ContainerDocker
	}
	if ContainerStd != Container || "dev" == Mode {
		ServerPort = FixedPort
	}

	msStoreFilePath := filepath.Join(WorkingDir, "ms-store")
	ISMicrosoftStore = gulu.File.IsExist(msStoreFilePath)

	UserAgent = UserAgent + " " + Container
	httpclient.SetUserAgent(UserAgent)

	initWorkspaceDir(*workspacePath)

	SSL = *ssl
	LogPath = filepath.Join(TempDir, "siyuan.log")
	logging.SetLogPath(LogPath)

	// 工作空间仅允许被一个内核进程伺服
	tryLockWorkspace()

	AppearancePath = filepath.Join(ConfDir, "appearance")
	if "dev" == Mode {
		ThemesPath = filepath.Join(WorkingDir, "appearance", "themes")
		IconsPath = filepath.Join(WorkingDir, "appearance", "icons")
	} else {
		ThemesPath = filepath.Join(AppearancePath, "themes")
		IconsPath = filepath.Join(AppearancePath, "icons")
	}

	initPathDir()
	go initPandoc()

	bootBanner := figure.NewColorFigure("SiYuan", "isometric3", "green", true)
	logging.LogInfof("\n" + bootBanner.String())
	logBootInfo()
}

func setBootDetails(details string) {
	bootDetails = "v" + Ver + " " + details
}

func SetBootDetails(details string) {
	if 100 <= bootProgress {
		return
	}
	setBootDetails(details)
}

func IncBootProgress(progress float64, details string) {
	if 100 <= bootProgress {
		return
	}
	bootProgress += progress
	setBootDetails(details)
}

func IsBooted() bool {
	return 100 <= bootProgress
}

func GetBootProgressDetails() (float64, string) {
	return bootProgress, bootDetails
}

func GetBootProgress() float64 {
	return bootProgress
}

func SetBooted() {
	setBootDetails("Finishing boot...")
	bootProgress = 100
	logging.LogInfof("kernel booted")
}

var (
	HomeDir, _    = gulu.OS.Home()
	WorkingDir, _ = os.Getwd()

	WorkspaceDir   string        // 工作空间目录路径
	WorkspaceLock  *flock.Flock  // 工作空间锁
	ConfDir        string        // 配置目录路径
	DataDir        string        // 数据目录路径
	RepoDir        string        // 仓库目录路径
	HistoryDir     string        // 数据历史目录路径
	TempDir        string        // 临时目录路径
	LogPath        string        // 配置目录下的日志文件 siyuan.log 路径
	DBName         = "siyuan.db" // SQLite 数据库文件名
	DBPath         string        // SQLite 数据库文件路径
	HistoryDBPath  string        // SQLite 历史数据库文件路径
	BlockTreePath  string        // 区块树文件路径
	PandocBinPath  string        // Pandoc 可执行文件路径
	AppearancePath string        // 配置目录下的外观目录 appearance/ 路径
	ThemesPath     string        // 配置目录下的外观目录下的 themes/ 路径
	IconsPath      string        // 配置目录下的外观目录下的 icons/ 路径
	SnippetsPath   string        // 数据目录下的 snippets/ 路径

	UIProcessIDs = sync.Map{} // UI 进程 ID

	IsNewbie bool // 是否是第一次安装
)

func initWorkspaceDir(workspaceArg string) {
	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	workspaceConf := filepath.Join(userHomeConfDir, "workspace.json")
	if !gulu.File.IsExist(workspaceConf) {
		IsNewbie = ContainerStd == Container // 只有桌面端需要设置新手标识，前端自动挂载帮助文档
		if err := os.MkdirAll(userHomeConfDir, 0755); nil != err && !os.IsExist(err) {
			log.Printf("create user home conf folder [%s] failed: %s", userHomeConfDir, err)
			os.Exit(ExitCodeCreateConfDirErr)
		}
	}

	defaultWorkspaceDir := filepath.Join(HomeDir, "Documents", "SiYuan")
	if gulu.OS.IsWindows() {
		// 改进 Windows 端默认工作空间路径 https://github.com/siyuan-note/siyuan/issues/5622
		if userProfile := os.Getenv("USERPROFILE"); "" != userProfile {
			defaultWorkspaceDir = filepath.Join(userProfile, "Documents", "SiYuan")
		}
	}

	var workspacePaths []string
	if !gulu.File.IsExist(workspaceConf) {
		WorkspaceDir = defaultWorkspaceDir
		if "" != workspaceArg {
			WorkspaceDir = workspaceArg
		}
		if !gulu.File.IsDir(WorkspaceDir) {
			log.Printf("use the default workspace [%s] since the specified workspace [%s] is not a dir", defaultWorkspaceDir, WorkspaceDir)
			WorkspaceDir = defaultWorkspaceDir
		}
		workspacePaths = append(workspacePaths, WorkspaceDir)
	} else {
		data, err := os.ReadFile(workspaceConf)
		if err = gulu.JSON.UnmarshalJSON(data, &workspacePaths); nil != err {
			log.Printf("unmarshal workspace conf [%s] failed: %s", workspaceConf, err)
		}

		var tmp []string
		for _, d := range workspacePaths {
			d = strings.TrimRight(d, " \t\n") // 去掉工作空间路径尾部空格 https://github.com/siyuan-note/siyuan/issues/6353
			if gulu.File.IsDir(d) {
				tmp = append(tmp, d)
			}
		}
		workspacePaths = tmp

		if 0 < len(workspacePaths) {
			WorkspaceDir = workspacePaths[len(workspacePaths)-1]
			if "" != workspaceArg {
				WorkspaceDir = workspaceArg
			}
			if !gulu.File.IsDir(WorkspaceDir) {
				log.Printf("use the default workspace [%s] since the specified workspace [%s] is not a dir", WorkspaceDir, defaultWorkspaceDir)
				WorkspaceDir = defaultWorkspaceDir
			}
			workspacePaths[len(workspacePaths)-1] = WorkspaceDir
		} else {
			WorkspaceDir = defaultWorkspaceDir
			if "" != workspaceArg {
				WorkspaceDir = workspaceArg
			}
			if !gulu.File.IsDir(WorkspaceDir) {
				log.Printf("use the default workspace [%s] since the specified workspace [%s] is not a dir", WorkspaceDir, defaultWorkspaceDir)
				WorkspaceDir = defaultWorkspaceDir
			}
			workspacePaths = append(workspacePaths, WorkspaceDir)
		}
	}

	if data, err := gulu.JSON.MarshalJSON(workspacePaths); nil == err {
		if err = os.WriteFile(workspaceConf, data, 0644); nil != err {
			log.Fatalf("write workspace conf [%s] failed: %s", workspaceConf, err)
		}
	} else {
		log.Fatalf("marshal workspace conf [%s] failed: %s", workspaceConf, err)
	}

	ConfDir = filepath.Join(WorkspaceDir, "conf")
	DataDir = filepath.Join(WorkspaceDir, "data")
	RepoDir = filepath.Join(WorkspaceDir, "repo")
	HistoryDir = filepath.Join(WorkspaceDir, "history")
	TempDir = filepath.Join(WorkspaceDir, "temp")
	osTmpDir := filepath.Join(TempDir, "os")
	os.RemoveAll(osTmpDir)
	if err := os.MkdirAll(osTmpDir, 0755); nil != err {
		log.Fatalf("create os tmp dir [%s] failed: %s", osTmpDir, err)
	}
	os.RemoveAll(filepath.Join(TempDir, "repo"))
	os.Setenv("TMPDIR", osTmpDir)
	os.Setenv("TEMP", osTmpDir)
	os.Setenv("TMP", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	HistoryDBPath = filepath.Join(TempDir, "history.db")
	BlockTreePath = filepath.Join(TempDir, "blocktree.msgpack")
	SnippetsPath = filepath.Join(DataDir, "snippets")
}

var (
	ServerPort     = "0" // HTTP/WebSocket 端口，0 为使用随机端口
	ReadOnly       bool
	AccessAuthCode string
	Lang           = ""

	Container        string // docker, android, ios, std
	ISMicrosoftStore bool   // 桌面端是否是微软商店版
)

const (
	ContainerStd     = "std"     // 桌面端
	ContainerDocker  = "docker"  // Docker 容器端
	ContainerAndroid = "android" // Android 端
	ContainerIOS     = "ios"     // iOS 端

	LocalHost = "127.0.0.1" // 伺服地址
	FixedPort = "6806"      // 固定端口
)

func initPathDir() {
	if err := os.MkdirAll(ConfDir, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create conf folder [%s] failed: %s", ConfDir, err)
	}
	if err := os.MkdirAll(DataDir, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create data folder [%s] failed: %s", DataDir, err)
	}
	if err := os.MkdirAll(TempDir, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create temp folder [%s] failed: %s", TempDir, err)
	}

	assets := filepath.Join(DataDir, "assets")
	if err := os.MkdirAll(assets, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create data assets folder [%s] failed: %s", assets, err)
	}

	templates := filepath.Join(DataDir, "templates")
	if err := os.MkdirAll(templates, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create data templates folder [%s] failed: %s", templates, err)
	}

	widgets := filepath.Join(DataDir, "widgets")
	if err := os.MkdirAll(widgets, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create data widgets folder [%s] failed: %s", widgets, err)
	}

	emojis := filepath.Join(DataDir, "emojis")
	if err := os.MkdirAll(emojis, 0755); nil != err && !os.IsExist(err) {
		log.Fatalf("create data emojis folder [%s] failed: %s", widgets, err)
	}
}

func initMime() {
	// 在某版本的 Windows 10 操作系统上界面样式异常问题
	// https://github.com/siyuan-note/siyuan/issues/247
	// https://github.com/siyuan-note/siyuan/issues/3813
	mime.AddExtensionType(".css", "text/css")
	mime.AddExtensionType(".js", "application/x-javascript")
	mime.AddExtensionType(".json", "application/json")
	mime.AddExtensionType(".html", "text/html")

	// 某些系统上下载资源文件后打开是 zip
	// https://github.com/siyuan-note/siyuan/issues/6347
	mime.AddExtensionType(".doc", "application/msword")
	mime.AddExtensionType(".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	mime.AddExtensionType(".xls", "application/vnd.ms-excel")
	mime.AddExtensionType(".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	mime.AddExtensionType(".dwg", "image/x-dwg")
	mime.AddExtensionType(".dxf", "image/x-dxf")
	mime.AddExtensionType(".dwf", "drawing/x-dwf")
	mime.AddExtensionType(".pdf", "application/pdf")
}

func initPandoc() {
	if ContainerStd != Container {
		return
	}

	pandocDir := filepath.Join(TempDir, "pandoc")
	if gulu.OS.IsWindows() {
		PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc.exe")
	} else if gulu.OS.IsDarwin() || gulu.OS.IsLinux() {
		PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc")
	}
	pandocVer := getPandocVer(PandocBinPath)
	if "" != pandocVer {
		logging.LogInfof("built-in pandoc [ver=%s, bin=%s]", pandocVer, PandocBinPath)
		return
	}

	pandocZip := filepath.Join(WorkingDir, "pandoc.zip")
	if "dev" == Mode {
		if gulu.OS.IsWindows() {
			pandocZip = filepath.Join(WorkingDir, "pandoc/pandoc-windows-amd64.zip")
		} else if gulu.OS.IsDarwin() {
			pandocZip = filepath.Join(WorkingDir, "pandoc/pandoc-darwin-amd64.zip")
		} else if gulu.OS.IsLinux() {
			pandocZip = filepath.Join(WorkingDir, "pandoc/pandoc-linux-amd64.zip")
		}
	}
	if err := gulu.Zip.Unzip(pandocZip, pandocDir); nil != err {
		logging.LogErrorf("unzip pandoc failed: %s", err)
		return
	}

	if gulu.OS.IsDarwin() || gulu.OS.IsLinux() {
		exec.Command("chmod", "+x", PandocBinPath).CombinedOutput()
	}
	pandocVer = getPandocVer(PandocBinPath)
	logging.LogInfof("initialized built-in pandoc [ver=%s, bin=%s]", pandocVer, PandocBinPath)
}

func getPandocVer(binPath string) (ret string) {
	if "" == binPath {
		return
	}

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "pandoc") {
		parts := bytes.Split(data, []byte("\n"))
		if 0 < len(parts) {
			ret = strings.TrimPrefix(string(parts[0]), "pandoc")
			ret = strings.ReplaceAll(ret, ".exe", "")
			ret = strings.TrimSpace(ret)
		}
		return
	}
	return
}

func IsValidPandocBin(binPath string) bool {
	if "" == binPath {
		return false
	}

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "pandoc") {
		return true
	}
	return false
}

func GetDataAssetsAbsPath() (ret string) {
	ret = filepath.Join(DataDir, "assets")
	var err error
	stat, err := os.Lstat(ret)
	if nil != err {
		logging.LogErrorf("stat assets failed: %s", err)
		return
	}
	if 0 != stat.Mode()&os.ModeSymlink {
		// 跟随符号链接 https://github.com/siyuan-note/siyuan/issues/5480
		ret, err = os.Readlink(ret)
		if nil != err {
			logging.LogErrorf("read assets link failed: %s", err)
		}
	}
	return
}

func tryLockWorkspace() {
	WorkspaceLock = flock.New(filepath.Join(WorkspaceDir, ".lock"))
	ok, err := WorkspaceLock.TryLock()
	if ok {
		return
	}
	if nil != err {
		logging.LogErrorf("lock workspace [%s] failed: %s", WorkspaceDir, err)
	} else {
		logging.LogErrorf("lock workspace [%s] failed", WorkspaceDir)
	}
	os.Exit(ExitCodeWorkspaceLocked)
}

func UnlockWorkspace() {
	if nil == WorkspaceLock {
		return
	}

	if err := WorkspaceLock.Unlock(); nil != err {
		logging.LogErrorf("unlock workspace [%s] failed: %s", WorkspaceDir, err)
		return
	}

	if err := os.Remove(filepath.Join(WorkspaceDir, ".lock")); nil != err {
		logging.LogErrorf("remove workspace lock failed: %s", err)
		return
	}
}
