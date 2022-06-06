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
	goPS "github.com/mitchellh/go-ps"
)

//var Mode = "dev"
//
var Mode = "prod"

const (
	Ver       = "2.0.17"
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

	workspacePath := flag.String("workspace", "", "dir path of the workspace, default to ~/Documents/SiYuan/")
	wdPath := flag.String("wd", WorkingDir, "working directory of SiYuan")
	servePath := flag.String("servePath", "", "obsoleted https://github.com/siyuan-note/siyuan/issues/4647")
	_ = servePath
	resident := flag.Bool("resident", true, "resident memory even if no active session")
	readOnly := flag.Bool("readonly", false, "read-only mode")
	accessAuthCode := flag.String("accessAuthCode", "", "access auth code")
	ssl := flag.Bool("ssl", false, "for https and wss")
	lang := flag.String("lang", "en_US", "zh_CN/zh_CHT/en_US/fr_FR")
	mode := flag.String("mode", "prod", "dev/prod")
	flag.Parse()

	if "" != *wdPath {
		WorkingDir = *wdPath
	}
	if "" != *lang {
		Lang = *lang
	}
	Mode = *mode
	Resident = *resident
	ReadOnly = *readOnly
	AccessAuthCode = *accessAuthCode
	Container = "std"
	if isRunningInDockerContainer() {
		Container = "docker"
	}

	initWorkspaceDir(*workspacePath)

	SSL = *ssl
	LogPath = filepath.Join(TempDir, "siyuan.log")
	AppearancePath = filepath.Join(ConfDir, "appearance")
	if "dev" == Mode {
		ThemesPath = filepath.Join(WorkingDir, "appearance", "themes")
		IconsPath = filepath.Join(WorkingDir, "appearance", "icons")
	} else {
		ThemesPath = filepath.Join(AppearancePath, "themes")
		IconsPath = filepath.Join(AppearancePath, "icons")
	}

	initPathDir()
	checkPort()

	bootBanner := figure.NewColorFigure("SiYuan", "isometric3", "green", true)
	LogInfof("\n" + bootBanner.String())
	logBootInfo()

	go cleanOld()
}

func SetBootDetails(details string) {
	if 100 <= bootProgress {
		return
	}
	bootDetails = details
}

func IncBootProgress(progress float64, details string) {
	if 100 <= bootProgress {
		return
	}
	bootProgress += progress
	bootDetails = details
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
	bootDetails = "Finishing boot..."
	bootProgress = 100
	LogInfof("kernel booted")
}

func GetHistoryDirNow(now, suffix string) (ret string, err error) {
	ret = filepath.Join(WorkspaceDir, "history", now+"-"+suffix)
	if err = os.MkdirAll(ret, 0755); nil != err {
		LogErrorf("make history dir failed: %s", err)
		return
	}
	return
}

func GetHistoryDir(suffix string) (ret string, err error) {
	ret = filepath.Join(WorkspaceDir, "history", time.Now().Format("2006-01-02-150405")+"-"+suffix)
	if err = os.MkdirAll(ret, 0755); nil != err {
		LogErrorf("make history dir failed: %s", err)
		return
	}
	return
}

var (
	HomeDir, _    = gulu.OS.Home()
	WorkingDir, _ = os.Getwd()

	WorkspaceDir   string        // 工作空间目录路径
	ConfDir        string        // 配置目录路径
	DataDir        string        // 数据目录路径
	TempDir        string        // 临时目录路径
	LogPath        string        // 配置目录下的日志文件 siyuan.log 路径
	DBName         = "siyuan.db" // SQLite 数据库文件名
	DBPath         string        // SQLite 数据库文件路径
	BlockTreePath  string        // 区块树文件路径
	AppearancePath string        // 配置目录下的外观目录 appearance/ 路径
	ThemesPath     string        // 配置目录下的外观目录下的 themes/ 路径
	IconsPath      string        // 配置目录下的外观目录下的 icons/ 路径

	AndroidNativeLibDir   string // Android 库路径
	AndroidPrivateDataDir string // Android 私有数据路径

	UIProcessIDs = sync.Map{} // UI 进程 ID

	IsNewbie bool // 是否是第一次安装
)

func initWorkspaceDir(workspaceArg string) {
	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	workspaceConf := filepath.Join(userHomeConfDir, "workspace.json")
	if !gulu.File.IsExist(workspaceConf) {
		IsNewbie = "std" == Container // 只有桌面端需要设置新手标识，前端自动挂载帮助文档
		if err := os.MkdirAll(userHomeConfDir, 0755); nil != err && !os.IsExist(err) {
			log.Printf("create user home conf folder [%s] failed: %s", userHomeConfDir, err)
			os.Exit(ExitCodeCreateConfDirErr)
		}
	}

	defaultWorkspaceDir := filepath.Join(HomeDir, "Documents", "SiYuan")
	var workspacePaths []string
	if !gulu.File.IsExist(workspaceConf) {
		WorkspaceDir = defaultWorkspaceDir
		if "" != workspaceArg {
			WorkspaceDir = workspaceArg
		}
		if !gulu.File.IsDir(WorkspaceDir) {
			log.Printf("use the default workspace [%s] since the specified workspace [%s] is not a dir", WorkspaceDir, defaultWorkspaceDir)
			WorkspaceDir = defaultWorkspaceDir
		}
		workspacePaths = append(workspacePaths, WorkspaceDir)
	} else {
		data, err := os.ReadFile(workspaceConf)
		if err = gulu.JSON.UnmarshalJSON(data, &workspacePaths); nil != err {
			log.Printf("unmarshal workspace conf [%s] failed: %s", workspaceConf, err)
		}

		tmp := workspacePaths[:0]
		for _, d := range workspacePaths {
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
	TempDir = filepath.Join(WorkspaceDir, "temp")
	osTmpDir := filepath.Join(TempDir, "os")
	os.RemoveAll(osTmpDir)
	if err := os.MkdirAll(osTmpDir, 0755); nil != err {
		log.Fatalf("create os tmp dir [%s] failed: %s", osTmpDir, err)
	}
	os.Setenv("TMPDIR", osTmpDir)
	os.Setenv("TEMP", osTmpDir)
	os.Setenv("TMP", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	BlockTreePath = filepath.Join(TempDir, "blocktree.msgpack")
}

var (
	Resident       bool
	ReadOnly       bool
	AccessAuthCode string
	Lang           = "en_US"

	Container string // docker, android, ios, std
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

func cleanOld() {
	dirs, _ := os.ReadDir(WorkingDir)
	for _, dir := range dirs {
		if strings.HasSuffix(dir.Name(), ".old") {
			old := filepath.Join(WorkingDir, dir.Name())
			os.RemoveAll(old)
		}
	}
}

func checkPort() {
	portOpened := isPortOpen(ServerPort)
	if !portOpened {
		return
	}

	LogInfof("port [%s] is opened, try to check version of running kernel", ServerPort)
	result := NewResult()
	_, err := NewBrowserRequest("").
		SetResult(result).
		SetHeader("User-Agent", UserAgent).
		Get("http://127.0.0.1:" + ServerPort + "/api/system/version")
	if nil != err || 0 != result.Code {
		LogErrorf("connect to port [%s] for checking running kernel failed", ServerPort)
		KillByPort(ServerPort)
		return
	}

	if nil == result.Data {
		LogErrorf("connect ot port [%s] for checking running kernel failed", ServerPort)
		os.Exit(ExitCodeUnavailablePort)
	}

	runningVer := result.Data.(string)
	if runningVer == Ver {
		LogInfof("version of the running kernel is the same as this boot [%s], exit this boot", runningVer)
		os.Exit(ExitCodeOk)
	}

	LogInfof("found kernel [%s] is running, try to exit it", runningVer)
	processes, err := goPS.Processes()
	if nil != err {
		LogErrorf("close kernel [%s] failed: %s", runningVer, err)
		os.Exit(ExitCodeUnavailablePort)
	}

	currentPid := os.Getpid()
	for _, p := range processes {
		name := p.Executable()
		if strings.Contains(strings.ToLower(name), "siyuan-kernel") || strings.Contains(strings.ToLower(name), "siyuan kernel") {
			kernelPid := p.Pid()
			if currentPid != kernelPid {
				pid := strconv.Itoa(kernelPid)
				Kill(pid)
				LogInfof("killed kernel [name=%s, pid=%s, ver=%s], continue to boot", name, pid, runningVer)
			}
		}
	}

	if !tryToListenPort() {
		os.Exit(ExitCodeUnavailablePort)
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
}

func KillByPort(port string) {
	if pid := PidByPort(port); "" != pid {
		pidInt, _ := strconv.Atoi(pid)
		proc, _ := goPS.FindProcess(pidInt)
		var name string
		if nil != proc {
			name = proc.Executable()
		}
		Kill(pid)
		LogInfof("killed process [name=%s, pid=%s]", name, pid)
	}
}

func Kill(pid string) {
	var kill *exec.Cmd
	if gulu.OS.IsWindows() {
		kill = exec.Command("cmd", "/c", "TASKKILL /F /PID "+pid)
	} else {
		kill = exec.Command("kill", "-9", pid)
	}
	CmdAttr(kill)
	kill.CombinedOutput()
}

func PidByPort(port string) (ret string) {
	if gulu.OS.IsWindows() {
		cmd := exec.Command("cmd", "/c", "netstat -ano | findstr "+port)
		CmdAttr(cmd)
		data, err := cmd.CombinedOutput()
		if nil != err {
			LogErrorf("netstat failed: %s", err)
			return
		}
		output := string(data)
		lines := strings.Split(output, "\n")
		for _, l := range lines {
			if strings.Contains(l, "LISTENING") {
				l = l[strings.Index(l, "LISTENING")+len("LISTENING"):]
				l = strings.TrimSpace(l)
				ret = l
				return
			}
		}
		return
	}

	cmd := exec.Command("lsof", "-Fp", "-i", ":"+port)
	CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		LogErrorf("lsof failed: %s", err)
		return
	}
	output := string(data)
	lines := strings.Split(output, "\n")
	for _, l := range lines {
		if strings.HasPrefix(l, "p") {
			l = l[1:]
			ret = l
			return
		}
	}
	return
}
