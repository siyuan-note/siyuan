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
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/88250/gulu"
	figure "github.com/common-nighthawk/go-figure"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

func BootMobile(container, appDir, workspaceBaseDir, lang string) {
	IncBootProgress(3, "Booting kernel...")
	rand.Seed(time.Now().UTC().UnixNano())
	initMime()
	initHttpClient()
	ServerPort = FixedPort
	Container = container
	UserAgent = UserAgent + " " + Container + "/" + runtime.GOOS
	httpclient.SetUserAgent(UserAgent)
	Lang = lang

	WorkingDir = filepath.Join(appDir, "app")
	HomeDir = filepath.Join(workspaceBaseDir, "home")
	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	logging.SetLogPath(filepath.Join(userHomeConfDir, "kernel.log"))

	if !gulu.File.IsExist(userHomeConfDir) {
		if err := os.MkdirAll(userHomeConfDir, 0755); nil != err && !os.IsExist(err) {
			logging.LogErrorf("create user home conf folder [%s] failed: %s", userHomeConfDir, err)
			os.Exit(logging.ExitCodeInitWorkspaceErr)
		}
	}

	defaultWorkspaceDir := filepath.Join(workspaceBaseDir, "siyuan")
	if err := os.MkdirAll(defaultWorkspaceDir, 0755); nil != err && !os.IsExist(err) {
		logging.LogErrorf("create default workspace folder [%s] failed: %s", defaultWorkspaceDir, err)
		os.Exit(logging.ExitCodeInitWorkspaceErr)
	}

	initWorkspaceDirMobile(workspaceBaseDir)

	initPathDir()
	bootBanner := figure.NewFigure("SiYuan", "", true)
	logging.LogInfof("\n" + bootBanner.String())
	logBootInfo()
}

func initWorkspaceDirMobile(workspaceBaseDir string) {
	if gulu.File.IsDir(workspaceBaseDir) {
		entries, err := os.ReadDir(workspaceBaseDir)
		if nil != err {
			logging.LogErrorf("read workspace dir [%s] failed: %s", workspaceBaseDir, err)
		} else {
			// 旧版 iOS 端会在 workspaceBaseDir 下直接创建工作空间，这里需要将数据迁移到 workspaceBaseDir/siyuan/ 文件夹下
			var oldConf, oldData, oldTemp bool
			for _, entry := range entries {
				if entry.IsDir() && "conf" == entry.Name() {
					oldConf = true
					continue
				}
				if entry.IsDir() && "data" == entry.Name() {
					oldData = true
					continue
				}
				if entry.IsDir() && "temp" == entry.Name() {
					oldTemp = true
					continue
				}
			}
			if oldConf && oldData && oldTemp {
				for _, entry := range entries {
					if "home" == entry.Name() || "siyuan" == entry.Name() {
						continue
					}

					from := filepath.Join(workspaceBaseDir, entry.Name())
					to := filepath.Join(workspaceBaseDir, "siyuan", entry.Name())
					if err = os.Rename(from, to); nil != err {
						logging.LogErrorf("move workspace dir [%s] failed: %s", workspaceBaseDir, err)
					} else {
						logging.LogInfof("moved workspace dir [fomr=%s, to=%s]", from, to)
					}
				}

				os.RemoveAll(filepath.Join(workspaceBaseDir, "sync"))
				os.RemoveAll(filepath.Join(workspaceBaseDir, "backup"))
			}
		}
	}

	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	workspaceConf := filepath.Join(userHomeConfDir, "workspace.json")
	defaultWorkspaceDir := filepath.Join(workspaceBaseDir, "siyuan")

	var workspacePaths []string
	if !gulu.File.IsExist(workspaceConf) {
		WorkspaceDir = defaultWorkspaceDir
		if !gulu.File.IsDir(WorkspaceDir) {
			logging.LogWarnf("use the default workspace [%s] since the specified workspace [%s] is not a dir", WorkspaceDir, defaultWorkspaceDir)
			WorkspaceDir = defaultWorkspaceDir
		}
		workspacePaths = append(workspacePaths, WorkspaceDir)
	} else {
		workspacePaths, _ = ReadWorkspacePaths()
		if 0 < len(workspacePaths) {
			WorkspaceDir = workspacePaths[len(workspacePaths)-1]
			if !gulu.File.IsDir(WorkspaceDir) {
				logging.LogWarnf("use the default workspace [%s] since the specified workspace [%s] is not a dir", defaultWorkspaceDir, WorkspaceDir)
				WorkspaceDir = defaultWorkspaceDir
			}
			workspacePaths[len(workspacePaths)-1] = WorkspaceDir
		} else {
			WorkspaceDir = defaultWorkspaceDir
			workspacePaths = append(workspacePaths, WorkspaceDir)
		}
	}

	if err := WriteWorkspacePaths(workspacePaths); nil != err {
		logging.LogErrorf("write workspace conf [%s] failed: %s", workspaceConf, err)
		os.Exit(logging.ExitCodeInitWorkspaceErr)
	}

	ConfDir = filepath.Join(WorkspaceDir, "conf")
	DataDir = filepath.Join(WorkspaceDir, "data")
	RepoDir = filepath.Join(WorkspaceDir, "repo")
	HistoryDir = filepath.Join(WorkspaceDir, "history")
	TempDir = filepath.Join(WorkspaceDir, "temp")
	osTmpDir := filepath.Join(TempDir, "os")
	os.RemoveAll(osTmpDir)
	if err := os.MkdirAll(osTmpDir, 0755); nil != err {
		logging.LogErrorf("create os tmp dir [%s] failed: %s", osTmpDir, err)
		os.Exit(logging.ExitCodeInitWorkspaceErr)
	}
	os.RemoveAll(filepath.Join(TempDir, "repo"))
	os.Setenv("TMPDIR", osTmpDir)
	os.Setenv("TEMP", osTmpDir)
	os.Setenv("TMP", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	HistoryDBPath = filepath.Join(TempDir, "history.db")
	AssetContentDBPath = filepath.Join(TempDir, "asset_content.db")
	BlockTreeDBPath = filepath.Join(TempDir, "blocktree.db")
	SnippetsPath = filepath.Join(DataDir, "snippets")

	AppearancePath = filepath.Join(ConfDir, "appearance")
	ThemesPath = filepath.Join(AppearancePath, "themes")
	IconsPath = filepath.Join(AppearancePath, "icons")

	LogPath = filepath.Join(TempDir, "siyuan.log")
	logging.SetLogPath(LogPath)
}
