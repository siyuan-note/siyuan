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

package util

import (
	"errors"
	"flag"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	figure "github.com/common-nighthawk/go-figure"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"golang.org/x/mod/semver"
)

// var Mode = "dev"
var Mode = "prod"

const (
	Ver       = "3.7.3"
	IsInsider = false
)

// IsReleaseVer 判断是否为正式版（不含 alpha、beta、rc 等预发布标识）。
func IsReleaseVer(ver string) bool {
	v := "v" + strings.TrimPrefix(ver, "v")
	return semver.IsValid(v) && semver.Prerelease(v) == ""
}

var (
	RunInContainer             = false // 是否运行在容器中
	SiYuanAccessAuthCodeBypass = false // 是否跳过空锁屏密码检查
	AttachUI                   = false // 是否绑定桌面 UI 进程生命周期（Electron 拉起时为 true，手动 serve 为 false）
)

func initEnvVars() {
	RunInContainer = isRunningInDockerContainer()
	var err error
	if SiYuanAccessAuthCodeBypass, err = strconv.ParseBool(os.Getenv("SIYUAN_ACCESS_AUTH_CODE_BYPASS")); err != nil {
		SiYuanAccessAuthCodeBypass = false
	}
}

var (
	bootProgress = atomic.Int32{} // 启动进度，从 0 到 100
	bootDetails  string           // 启动细节描述
	HttpServer   *http.Server     // HTTP 伺服器实例
	HttpServing  = false          // 是否 HTTP 伺服已经可用

	SafeMode = false // 是否以安全模式启动：禁用代码片段、插件、自定义主题与图标
)

// If a commandline parameter is empty, fallback to the env var.
//
// "empty" means the parameter is not set or set to an empty string.
// It returns a pointer to string, to be a drop-in replacement for
// the commandline parameter itself.
func coalesceToEnvVar(fromCLI *string, envVarName string) *string {
	if fromCLI == nil || "" == *fromCLI {
		ret := os.Getenv(envVarName)
		return &ret
	}
	return fromCLI
}

func InitWorkspace(workspacePath, wdPath string) {
	initEnvVars()
	initMime()
	initHttpClient()

	if "" != wdPath {
		WorkingDir = wdPath
	}

	Container = ContainerStd
	if RunInContainer {
		Container = ContainerDocker
	}

	initWorkspaceDir(workspacePath)
	initPathDir()

	AppearancePath = filepath.Join(ConfDir, "appearance")
	if "dev" == Mode {
		ThemesPath = filepath.Join(WorkingDir, "appearance", "themes")
		IconsPath = filepath.Join(WorkingDir, "appearance", "icons")
	} else {
		ThemesPath = filepath.Join(AppearancePath, "themes")
		IconsPath = filepath.Join(AppearancePath, "icons")
	}

	LogPath = filepath.Join(TempDir, "siyuan.log")
}

func Boot() {
	IncBootProgress(3, BootL10n(299, "Booting kernel..."))

	// 由标准库 flag 解析 os.Args，再走统一的 BootWithFlags。
	workspacePath := flag.String("workspace", "", "dir path of the workspace, default to ~/SiYuan/")
	wdPath := flag.String("wd", WorkingDir, "working directory of SiYuan")
	port := flag.String("port", "0", "port of the HTTP server")
	readOnly := flag.String("readonly", "false", "read-only mode")
	accessAuthCode := flag.String("accessAuthCode", "", "access auth code")
	ssl := flag.Bool("ssl", false, "for https and wss")
	attachUI := flag.Bool("attach-ui", false, "attach kernel lifecycle to desktop UI process (used by Electron)")
	lang := flag.String("lang", "", "ar/de/en/es/fr/he/hi/id/it/ja/ko/nl/pl/pt-BR/ru/sk/th/tr/uk/zh-CN/zh-TW")
	mode := flag.String("mode", "prod", "dev/prod")
	safeMode := flag.Bool("safe-mode", false, "boot in safe mode")
	flag.Parse()

	BootWithFlags(*workspacePath, *wdPath, *port, *readOnly, *accessAuthCode, *lang, *mode, *ssl, *attachUI, *safeMode)
}

// BootWithFlags 接收已解析好的启动参数，完成环境变量回退、全局变量赋值、工作空间初始化与加锁等启动收尾工作。Boot()（标准库 flag 解析）和 serve 子命令（cobra 解析）都走这个统一入口。
func BootWithFlags(workspacePath, wdPath, port, readOnly, accessAuthCode, lang, mode string, ssl, attachUI, safeMode bool) {
	SafeMode = safeMode
	// Fallback to env vars if commandline args are not set
	// valid only for CLI args that default to "", as the
	// others have explicit (sane) defaults
	workspacePath = *coalesceToEnvVar(&workspacePath, "SIYUAN_WORKSPACE_PATH")
	accessAuthCode = *coalesceToEnvVar(&accessAuthCode, "SIYUAN_ACCESS_AUTH_CODE")
	lang = *coalesceToEnvVar(&lang, "SIYUAN_LANG")

	if "" != lang {
		Lang = LangToBCP47(lang) // 兼容历史下划线值，如 zh_CN → zh-CN
	}
	Mode = mode
	ServerPort = port
	ReadOnly, _ = strconv.ParseBool(readOnly)
	AttachUI = attachUI
	AccessAuthCode = accessAuthCode
	AccessAuthCode = RemoveInvalid(AccessAuthCode)
	AccessAuthCode = strings.TrimSpace(AccessAuthCode)
	Container = ContainerStd
	if RunInContainer {
		Container = ContainerDocker
		if "" == AccessAuthCode { // Still empty?
			interruptBoot := true

			// Set the env `SIYUAN_ACCESS_AUTH_CODE_BYPASS=true` to skip checking empty access auth code https://github.com/siyuan-note/siyuan/issues/9709
			if SiYuanAccessAuthCodeBypass {
				interruptBoot = false
				fmt.Println("bypass access auth code check since the env [SIYUAN_ACCESS_AUTH_CODE_BYPASS] is set to [true]")
			}

			if interruptBoot {
				// The access authorization code command line parameter must be set when deploying via Docker https://github.com/siyuan-note/siyuan/issues/9328
				fmt.Printf("the access authorization code command line parameter (--accessAuthCode) must be set when deploying via Docker\n")
				fmt.Printf("or you can set the SIYUAN_ACCESS_AUTH_CODE env var")
				os.Exit(logging.ExitCodeSecurityRisk)
			}
		}
	}
	if ContainerStd != Container {
		ServerPort = FixedPort
	}

	UserAgent = UserAgent + " " + Container + "/" + runtime.GOOS
	httpclient.SetUserAgent(UserAgent)

	InitWorkspace(workspacePath, wdPath)

	// 必须在 InitWorkspace 之后：此时 WorkingDir 才被 --wd 参数修正为真实工作目录（如 app\resources），否则会用进程 CWD 误判微软商店版标记文件
	msStoreFilePath := filepath.Join(WorkingDir, "ms-store")
	ISMicrosoftStore = gulu.File.IsExist(msStoreFilePath)

	SSL = ssl
	logging.SetLogPath(LogPath)

	// 工作空间仅允许被一个内核进程伺服
	tryLockWorkspace()

	bootBanner := figure.NewColorFigure("SiYuan", "isometric3", "green", true)
	logging.LogInfo("\n" + bootBanner.String())
	logBootInfo()
}

var bootDetailsLock = sync.Mutex{}

func setBootDetails(details string) {
	bootDetailsLock.Lock()
	bootDetails = "v" + Ver + " " + details
	bootDetailsLock.Unlock()
}

func SetBootDetails(details string) {
	if 100 <= bootProgress.Load() {
		return
	}
	setBootDetails(details)
}

// BootL10n 返回启动进度文案的本地化字符串。
//
// 按当前界面语言（util.Lang，来自 conf.json）查 util.Langs 中 _kernel 块的整数键，
// 依次回退到英文、再回退到调用方传入的 fallback 英文文案。
// 这样在首启 InitConf() 尚未加载完语言文件时也能显示原文，不会出现空串。
func BootL10n(num int, fallback string) string {
	if s := Langs[Lang][num]; "" != s {
		return s
	}
	if s := Langs["en"][num]; "" != s {
		return s
	}
	return fallback
}

func IncBootProgress(progress int32, details string) {
	if 100 <= bootProgress.Load() {
		return
	}
	bootProgress.Add(progress)
	setBootDetails(details)
}

func IsBooted() bool {
	return 100 <= bootProgress.Load()
}

func GetBootProgressDetails() (progress int32, details string) {
	progress = bootProgress.Load()
	bootDetailsLock.Lock()
	details = bootDetails
	bootDetailsLock.Unlock()
	return
}

func GetBootProgress() int32 {
	return bootProgress.Load()
}

func SetBooted() {
	// 先置进度为 100 再写 details，保证前端轮询/SSE 读到 progress>=100 时一定满足跳转条件，
	// 避免 "先写 details 后写 progress" 造成的 "Finishing boot... 但进度未满" 竞态窗口
	bootProgress.Store(100)
	setBootDetails(BootL10n(300, "Finishing boot..."))
	logging.LogInfof("kernel booted")
}

var (
	HomeDir, _    = gulu.OS.Home()
	WorkingDir, _ = os.Getwd()

	WorkspaceDir       string        // 工作空间目录路径
	WorkspaceName      string        // 工作空间名称
	WorkspaceLock      *flock.Flock  // 工作空间锁
	ConfDir            string        // 配置目录路径
	DataDir            string        // 数据目录路径
	RepoDir            string        // 仓库目录路径
	HistoryDir         string        // 数据历史目录路径
	TempDir            string        // 临时目录路径
	QueueDir           string        // 队列目录路径
	LogPath            string        // 配置目录下的日志文件 siyuan.log 路径
	DBName             = "siyuan.db" // SQLite 数据库文件名
	DBPath             string        // SQLite 数据库文件路径
	HistoryDBPath      string        // SQLite 历史数据库文件路径
	AssetContentDBPath string        // SQLite 资源文件内容数据库文件路径
	BlockTreeDBPath    string        // 区块树数据库文件路径
	AppearancePath     string        // 配置目录下的外观目录 appearance/ 路径
	ThemesPath         string        // 配置目录下的外观目录下的 themes/ 路径
	IconsPath          string        // 配置目录下的外观目录下的 icons/ 路径
	SnippetsPath       string        // 数据目录下的 snippets/ 路径
	ShortcutsPath      string        // 用户家目录下的快捷方式目录路径 home/.config/siyuan/shortcuts/

	UIProcessIDs = sync.Map{} // UI 进程 ID
)

func initWorkspaceDir(workspaceArg string) {
	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	workspaceConf := filepath.Join(userHomeConfDir, "workspace.json")
	logging.SetLogPath(filepath.Join(userHomeConfDir, "kernel.log"))

	if !gulu.File.IsExist(workspaceConf) {
		if err := os.MkdirAll(userHomeConfDir, 0755); err != nil && !os.IsExist(err) {
			logging.LogErrorf("create user home conf folder [%s] failed: %s", userHomeConfDir, err)
			os.Exit(logging.ExitCodeInitWorkspaceErr)
		}
	}

	defaultWorkspaceDir := filepath.Join(HomeDir, "SiYuan")
	if gulu.OS.IsWindows() {
		// 改进 Windows 端默认工作空间路径 https://github.com/siyuan-note/siyuan/issues/5622
		if userProfile := os.Getenv("USERPROFILE"); "" != userProfile {
			defaultWorkspaceDir = filepath.Join(userProfile, "SiYuan")
		}
	} else if gulu.OS.IsDarwin() {
		// Change the initial workspace path to ~/Library/Application Support/SiYuan on macOS https://github.com/siyuan-note/siyuan/issues/17095
		defaultWorkspaceDir = filepath.Join(HomeDir, "Library", "Application Support", "SiYuan")
	}

	var workspacePaths []string
	if !gulu.File.IsExist(workspaceConf) {
		WorkspaceDir = defaultWorkspaceDir
	} else {
		workspacePaths, _ = ReadWorkspacePaths()
		if 0 < len(workspacePaths) {
			WorkspaceDir = workspacePaths[len(workspacePaths)-1]
		} else {
			WorkspaceDir = defaultWorkspaceDir
		}
	}

	if "" != workspaceArg {
		WorkspaceDir = workspaceArg
	}

	// 归一化路径分隔符，使 WorkspaceDir 与 filepath.Join(WorkspaceDir, ...) 派生出的目录（HistoryDir/DataDir 等）保持一致
	// 否则 Windows 上用正斜杠启动（--workspace="D:/foo"）时，strings.TrimPrefix(path, util.WorkspaceDir) 会因分隔符不同而失败 https://github.com/siyuan-note/siyuan/issues/17862
	WorkspaceDir = filepath.Clean(WorkspaceDir)

	if !gulu.File.IsDir(WorkspaceDir) {
		logging.LogWarnf("use the default workspace [%s] since the specified workspace [%s] is not a dir", defaultWorkspaceDir, WorkspaceDir)
		if err := os.MkdirAll(defaultWorkspaceDir, 0755); err != nil && !os.IsExist(err) {
			logging.LogErrorf("create default workspace folder [%s] failed: %s", defaultWorkspaceDir, err)
			os.Exit(logging.ExitCodeInitWorkspaceErr)
		}
		WorkspaceDir = defaultWorkspaceDir
	}
	workspacePaths = append(workspacePaths, WorkspaceDir)

	if err := WriteWorkspacePaths(workspacePaths); err != nil {
		logging.LogErrorf("write workspace conf [%s] failed: %s", workspaceConf, err)
		os.Exit(logging.ExitCodeInitWorkspaceErr)
	}

	WorkspaceName = filepath.Base(WorkspaceDir)
	ConfDir = filepath.Join(WorkspaceDir, "conf")
	DataDir = filepath.Join(WorkspaceDir, "data")
	RepoDir = filepath.Join(WorkspaceDir, "repo")
	HistoryDir = filepath.Join(WorkspaceDir, "history")
	TempDir = filepath.Join(WorkspaceDir, "temp")
	QueueDir = filepath.Join(TempDir, "queue")
	osTmpDir := filepath.Join(TempDir, "os")
	os.RemoveAll(osTmpDir)
	if err := os.MkdirAll(osTmpDir, 0755); err != nil {
		logging.LogErrorf("create os tmp dir [%s] failed: %s", osTmpDir, err)
		os.Exit(logging.ExitCodeInitWorkspaceErr)
	}
	os.RemoveAll(filepath.Join(TempDir, "repo"))
	// export 目录只保存临时文件，启动时统一清理；插件不得依赖其中的文件跨进程存续。
	os.RemoveAll(filepath.Join(TempDir, "export"))
	os.Setenv("TMPDIR", osTmpDir)
	os.Setenv("TEMP", osTmpDir)
	os.Setenv("TMP", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	HistoryDBPath = filepath.Join(TempDir, "history.db")
	AssetContentDBPath = filepath.Join(TempDir, "asset_content.db")
	BlockTreeDBPath = filepath.Join(TempDir, "blocktree.db")
	SnippetsPath = filepath.Join(DataDir, "snippets")
	ShortcutsPath = filepath.Join(userHomeConfDir, "shortcuts")
}

func DeduplicateWorkspacePaths(paths []string) []string {
	if !gulu.OS.IsWindows() {
		return gulu.Str.RemoveDuplicatedElem(paths)
	}
	seen := map[string]bool{}
	var result []string
	for _, p := range paths {
		key := strings.ToLower(filepath.Clean(p)) // 归一化后再去重，使 D:/foo、D:\foo、D:\foo\ 等被识别为同一工作空间 https://github.com/siyuan-note/siyuan/issues/17862
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, p)
	}
	return result
}

func RemoveWorkspacePath(paths []string, target string) []string {
	if !gulu.OS.IsWindows() {
		return gulu.Str.RemoveElem(paths, target)
	}
	targetLower := strings.ToLower(target)
	var result []string
	for _, p := range paths {
		if strings.ToLower(p) == targetLower {
			continue
		}
		result = append(result, p)
	}
	return result
}

func ReadWorkspacePaths() (ret []string, err error) {
	ret = []string{}
	workspaceConf := filepath.Join(HomeDir, ".config", "siyuan", "workspace.json")
	data, err := os.ReadFile(workspaceConf)
	if err != nil {
		msg := fmt.Sprintf("read workspace conf [%s] failed: %s", workspaceConf, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		msg := fmt.Sprintf("unmarshal workspace conf [%s] failed: %s", workspaceConf, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}

	var tmp []string
	workspaceBaseDir := filepath.Dir(HomeDir)
	for _, d := range ret {
		if ContainerIOS == Container && strings.Contains(d, "/Documents/") {
			// iOS 端沙箱路径会变化，需要转换为相对路径再拼接当前沙箱中的工作空间基路径
			d = d[strings.Index(d, "/Documents/")+len("/Documents/"):]
			d = filepath.Join(workspaceBaseDir, d)
		}

		d = strings.TrimRight(d, " \t\n") // 去掉工作空间路径尾部空格 https://github.com/siyuan-note/siyuan/issues/6353
		d = filepath.Clean(d)             // 归一化路径分隔符，清理历史持久化的斜杠差异（如 D:/foo 与 D:\foo） https://github.com/siyuan-note/siyuan/issues/17862
		if gulu.File.IsDir(d) {
			tmp = append(tmp, d)
		} else {
			logging.LogWarnf("workspace path [%s] is not a dir", d)
		}
	}
	ret = tmp
	ret = DeduplicateWorkspacePaths(ret)
	return
}

func WriteWorkspacePaths(workspacePaths []string) (err error) {
	workspacePaths = DeduplicateWorkspacePaths(workspacePaths)
	workspaceConf := filepath.Join(HomeDir, ".config", "siyuan", "workspace.json")
	data, err := gulu.JSON.MarshalJSON(workspacePaths)
	if err != nil {
		msg := fmt.Sprintf("marshal workspace conf [%s] failed: %s", workspaceConf, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}

	if err = filelock.WriteFile(workspaceConf, data); err != nil {
		msg := fmt.Sprintf("write workspace conf [%s] failed: %s", workspaceConf, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	return
}

var (
	ServerURL  *url.URL // 内核服务 URL
	ServerPort = "0"    // HTTP/WebSocket 端口，0 为使用随机端口

	ReadOnly       bool
	AccessAuthCode string
	Lang           = ""

	Container        string // docker, android, ios, harmony, std
	ISMicrosoftStore bool   // 桌面端是否是微软商店版
)

const (
	ContainerStd     = "std"     // 桌面端
	ContainerDocker  = "docker"  // Docker 容器端
	ContainerAndroid = "android" // Android 端
	ContainerIOS     = "ios"     // iOS 端
	ContainerHarmony = "harmony" // 鸿蒙端

	LocalHost = "127.0.0.1" // 伺服地址
	FixedPort = "6806"      // 固定端口
)

// IsMobileContainer 表示当前内核运行在 Android、iOS 或鸿蒙客户端上。
func IsMobileContainer() bool {
	return ContainerAndroid == Container || ContainerIOS == Container || ContainerHarmony == Container
}

func initPathDir() {
	if err := os.MkdirAll(ConfDir, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create conf folder [%s] failed: %s", ConfDir, err)
	}
	if err := os.MkdirAll(DataDir, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data folder [%s] failed: %s", DataDir, err)
	}
	if err := os.MkdirAll(TempDir, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create temp folder [%s] failed: %s", TempDir, err)
	}

	assets := filepath.Join(DataDir, "assets")
	if err := os.MkdirAll(assets, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data assets folder [%s] failed: %s", assets, err)
	}

	templates := filepath.Join(DataDir, "templates")
	if err := os.MkdirAll(templates, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data templates folder [%s] failed: %s", templates, err)
	}

	widgets := filepath.Join(DataDir, "widgets")
	if err := os.MkdirAll(widgets, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data widgets folder [%s] failed: %s", widgets, err)
	}

	plugins := filepath.Join(DataDir, "plugins")
	if err := os.MkdirAll(plugins, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data plugins folder [%s] failed: %s", plugins, err)
	}

	emojis := filepath.Join(DataDir, "emojis")
	if err := os.MkdirAll(emojis, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data emojis folder [%s] failed: %s", emojis, err)
	}

	queueDir := filepath.Join(TempDir, "queue")
	if err := os.MkdirAll(queueDir, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create queue folder [%s] failed: %s", queueDir, err)
	}

	// Support directly access `data/public/*` contents via URL link https://github.com/siyuan-note/siyuan/issues/8593
	public := filepath.Join(DataDir, "public")
	if err := os.MkdirAll(public, 0755); err != nil && !os.IsExist(err) {
		logging.LogFatalf(logging.ExitCodeInitWorkspaceErr, "create data public folder [%s] failed: %s", public, err)
	}
}

func initMime() {
	// 在某版本的 Windows 10 操作系统上界面样式异常问题
	// https://github.com/siyuan-note/siyuan/issues/247
	// https://github.com/siyuan-note/siyuan/issues/3813
	mime.AddExtensionType(".css", "text/css")
	mime.AddExtensionType(".js", "text/javascript")
	mime.AddExtensionType(".mjs", "text/javascript")
	mime.AddExtensionType(".html", "text/html")
	mime.AddExtensionType(".json", "application/json")
	mime.AddExtensionType(".woff2", "font/woff2")

	// 某些系统上下载资源文件后打开是 zip https://github.com/siyuan-note/siyuan/issues/6347
	mime.AddExtensionType(".doc", "application/msword")
	mime.AddExtensionType(".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	mime.AddExtensionType(".xls", "application/vnd.ms-excel")
	mime.AddExtensionType(".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	mime.AddExtensionType(".dwg", "image/x-dwg")
	mime.AddExtensionType(".dxf", "image/x-dxf")
	mime.AddExtensionType(".dwf", "drawing/x-dwf")
	mime.AddExtensionType(".pdf", "application/pdf")

	// 某些系统上无法显示 SVG 图片 SVG images cannot be displayed on some systems https://github.com/siyuan-note/siyuan/issues/9413
	mime.AddExtensionType(".svg", "image/svg+xml")

	// 文档数据文件
	mime.AddExtensionType(".sy", "application/json")

	mime.AddExtensionType(".md", "text/markdown")
	mime.AddExtensionType(".markdown", "text/markdown")

	// 添加常用的图片格式
	mime.AddExtensionType(".png", "image/png")
	mime.AddExtensionType(".jpg", "image/jpeg")
	mime.AddExtensionType(".jpeg", "image/jpeg")
	mime.AddExtensionType(".gif", "image/gif")
	mime.AddExtensionType(".bmp", "image/bmp")
	mime.AddExtensionType(".tiff", "image/tiff")
	mime.AddExtensionType(".tif", "image/tiff")
	mime.AddExtensionType(".webp", "image/webp")
	mime.AddExtensionType(".ico", "image/x-icon")
}

func GetDataAssetsAbsPath() (ret string) {
	ret = filepath.Join(DataDir, "assets")
	if IsSymlinkPath(ret) {
		// 跟随符号链接 https://github.com/siyuan-note/siyuan/issues/5480
		var err error
		ret, err = filepath.EvalSymlinks(ret)
		if err != nil {
			logging.LogErrorf("read assets link failed: %s", err)
		}
	}
	return
}

// EncryptedDBPath 返回加密笔记本的独立 SQLCipher db 文件路径。
// 与 siyuan.db 同放 temp 目录，文件名带 boxID 区分多个加密笔记本。db 是可重建的索引，非原始内容。
func EncryptedDBPath(boxID string) string {
	return filepath.Join(TempDir, "siyuan-encrypted-"+boxID+".db")
}

// EncryptedBlockTreeDBPath 返回加密笔记本的独立 SQLCipher blocktree db 文件路径。
func EncryptedBlockTreeDBPath(boxID string) string {
	return filepath.Join(TempDir, "siyuan-encrypted-"+boxID+"-blocktree.db")
}

func tryLockWorkspace() {
	WorkspaceLock = flock.New(filepath.Join(WorkspaceDir, ".lock"))
	ok, err := WorkspaceLock.TryLock()
	if ok {
		return
	}
	if err != nil {
		logging.LogErrorf("lock workspace [%s] failed: %s", WorkspaceDir, err)
	} else {
		logging.LogErrorf("lock workspace [%s] failed", WorkspaceDir)
	}
	os.Exit(logging.ExitCodeWorkspaceLocked)
}

func IsWorkspaceLocked(workspacePath string) bool {
	if !gulu.File.IsDir(workspacePath) {
		return false
	}

	lockFilePath := filepath.Join(workspacePath, ".lock")
	if !gulu.File.IsExist(lockFilePath) {
		return false
	}

	f := flock.New(lockFilePath)
	defer f.Unlock()
	ok, _ := f.TryLock()
	if ok {
		return false
	}
	return true
}

func UnlockWorkspace() {
	if nil == WorkspaceLock {
		return
	}

	if err := WorkspaceLock.Unlock(); err != nil {
		logging.LogErrorf("unlock workspace [%s] failed: %s", WorkspaceDir, err)
		return
	}

	if err := os.Remove(filepath.Join(WorkspaceDir, ".lock")); err != nil {
		logging.LogErrorf("remove workspace lock failed: %s", err)
		return
	}
}

func LogDatabaseSize(dbPath string) {
	dbFile, err := os.Stat(dbPath)
	if nil != err {
		return
	}

	dbSize := humanize.BytesCustomCeil(uint64(dbFile.Size()), 2)
	logging.LogInfof("database [%s] size [%s]", dbPath, dbSize)
}

func RemoveDatabaseFile(dbPath string) {
	if gulu.File.IsExist(dbPath) {
		err := os.RemoveAll(dbPath)
		if err != nil {
			logging.LogErrorf("remove database file [%s] failed: %s", dbPath, err)
			return
		}
	}

	if gulu.File.IsExist(dbPath + "-shm") {
		err := os.RemoveAll(dbPath + "-shm")
		if err != nil {
			logging.LogErrorf("remove database file [%s] failed: %s", dbPath+"-shm", err)
			return
		}
	}

	if gulu.File.IsExist(dbPath + "-wal") {
		err := os.RemoveAll(dbPath + "-wal")
		if err != nil {
			logging.LogErrorf("remove database file [%s] failed: %s", dbPath+"-wal", err)
			return
		}
	}
}
