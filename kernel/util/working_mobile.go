// SiYuan - From thought to insight, with agents
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
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"

	"github.com/88250/gulu"
	figure "github.com/common-nighthawk/go-figure"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

func BootMobile(container, appDir, workspaceBaseDir, lang string) {
	IncBootProgress(3, BootL10n(299, "Booting kernel..."))
	initMime()
	initHttpClient()
	ServerPort = FixedPort
	Container = container
	filelock.Container = Container
	UserAgent = UserAgent + " " + Container + "/" + runtime.GOOS
	httpclient.SetUserAgent(UserAgent)
	Lang = lang

	WorkingDir = filepath.Join(appDir, "app")
	HomeDir = filepath.Join(workspaceBaseDir, "home")
	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	logging.SetLogPath(filepath.Join(userHomeConfDir, "kernel.log"))

	if !gulu.File.IsExist(userHomeConfDir) {
		if err := os.MkdirAll(userHomeConfDir, 0755); err != nil && !os.IsExist(err) {
			logging.LogErrorf("create user home conf folder [%s] failed: %s", userHomeConfDir, err)
			os.Exit(logging.ExitCodeInitWorkspaceErr)
		}
	}

	defaultWorkspaceDir := filepath.Join(workspaceBaseDir, "siyuan")
	if err := os.MkdirAll(defaultWorkspaceDir, 0755); err != nil && !os.IsExist(err) {
		logging.LogErrorf("create default workspace folder [%s] failed: %s", defaultWorkspaceDir, err)
		os.Exit(logging.ExitCodeInitWorkspaceErr)
	}

	initWorkspaceDirMobile(workspaceBaseDir)

	initPathDir()
	bootBanner := figure.NewFigure("SiYuan", "", true)
	logging.LogInfo("\n" + bootBanner.String())
	logBootInfo()
}

func initWorkspaceDirMobile(workspaceBaseDir string) {
	migrated, err := migrateLegacyIOSWorkspace(workspaceBaseDir)
	if err != nil {
		logging.LogErrorf("migrate legacy iOS workspace [%s] failed: %s", workspaceBaseDir, err)
	}

	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	workspaceConf := filepath.Join(userHomeConfDir, "workspace.json")
	defaultWorkspaceDir := filepath.Join(workspaceBaseDir, "siyuan")

	var workspacePaths []string
	if !gulu.File.IsExist(workspaceConf) {
		logging.LogInfof("workspace conf [%s] not exist, use the default workspace [%s]", workspaceConf, defaultWorkspaceDir)
		WorkspaceDir = defaultWorkspaceDir
		if !gulu.File.IsDir(WorkspaceDir) {
			logging.LogWarnf("use the default workspace [%s] since the specified workspace [%s] is not a dir", WorkspaceDir, defaultWorkspaceDir)
			WorkspaceDir = defaultWorkspaceDir
		}
		workspacePaths = append(workspacePaths, WorkspaceDir)
	} else {
		workspacePaths, _ = ReadWorkspacePaths()
		if migrated {
			workspacePaths = replaceLegacyIOSWorkspacePath(workspacePaths, workspaceBaseDir, defaultWorkspaceDir)
		}

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
	os.Setenv("TMPDIR", osTmpDir)
	os.Setenv("TEMP", osTmpDir)
	os.Setenv("TMP", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	HistoryDBPath = filepath.Join(TempDir, "history.db")
	AssetContentDBPath = filepath.Join(TempDir, "asset_content.db")
	BlockTreeDBPath = filepath.Join(TempDir, "blocktree.db")
	SnippetsPath = filepath.Join(DataDir, "snippets")
	ShortcutsPath = filepath.Join(userHomeConfDir, "shortcuts")

	AppearancePath = filepath.Join(ConfDir, "appearance")
	ThemesPath = filepath.Join(AppearancePath, "themes")
	IconsPath = filepath.Join(AppearancePath, "icons")

	LogPath = filepath.Join(TempDir, "siyuan.log")
	logging.SetLogPath(LogPath)
}

// 仅迁移工作空间规范定义的目录，保留基目录下的其他工作空间和用户文件。
var legacyIOSWorkspaceEntries = []string{"conf", "data", "repo", "history", "corrupted", "temp", "sync", "backup"}

type workspaceDirMove struct {
	from string
	to   string
}

func migrateLegacyIOSWorkspace(workspaceBaseDir string) (migrated bool, err error) {
	if ContainerIOS != Container || !gulu.File.IsDir(workspaceBaseDir) {
		return false, nil
	}

	for _, name := range []string{"conf", "data", "temp"} {
		if !gulu.File.IsDir(filepath.Join(workspaceBaseDir, name)) {
			return false, nil
		}
	}

	defaultWorkspaceDir := filepath.Join(workspaceBaseDir, "siyuan")
	destinationEntries, readErr := os.ReadDir(defaultWorkspaceDir)
	if readErr != nil {
		return false, fmt.Errorf("read destination [%s] failed: %w", defaultWorkspaceDir, readErr)
	}
	if 0 < len(destinationEntries) {
		return false, fmt.Errorf("destination [%s] is not empty", defaultWorkspaceDir)
	}

	var moves []workspaceDirMove
	for _, name := range legacyIOSWorkspaceEntries {
		from := filepath.Join(workspaceBaseDir, name)
		if _, statErr := os.Lstat(from); statErr != nil {
			if errors.Is(statErr, fs.ErrNotExist) {
				continue
			}
			return false, fmt.Errorf("stat source [%s] failed: %w", from, statErr)
		}

		to := filepath.Join(defaultWorkspaceDir, name)
		if _, statErr := os.Lstat(to); statErr == nil {
			return false, fmt.Errorf("destination [%s] already exists", to)
		} else if !errors.Is(statErr, fs.ErrNotExist) {
			return false, fmt.Errorf("stat destination [%s] failed: %w", to, statErr)
		}
		moves = append(moves, workspaceDirMove{from: from, to: to})
	}

	var completed []workspaceDirMove
	for _, move := range moves {
		if renameErr := os.Rename(move.from, move.to); renameErr != nil {
			var rollbackErrors []error
			for i := len(completed) - 1; 0 <= i; i-- {
				completedMove := completed[i]
				if rollbackErr := os.Rename(completedMove.to, completedMove.from); rollbackErr != nil {
					rollbackErrors = append(rollbackErrors, fmt.Errorf("rollback [%s] to [%s] failed: %w",
						completedMove.to, completedMove.from, rollbackErr))
				}
			}
			return false, errors.Join(append([]error{fmt.Errorf("move [%s] to [%s] failed: %w", move.from, move.to, renameErr)}, rollbackErrors...)...)
		}
		completed = append(completed, move)
	}

	for _, move := range completed {
		logging.LogInfof("moved legacy iOS workspace dir [from=%s, to=%s]", move.from, move.to)
	}
	return true, nil
}

func replaceLegacyIOSWorkspacePath(workspacePaths []string, workspaceBaseDir, defaultWorkspaceDir string) []string {
	for i, workspacePath := range workspacePaths {
		if filepath.Clean(workspacePath) == filepath.Clean(workspaceBaseDir) {
			workspacePaths[i] = defaultWorkspaceDir
		}
	}
	return DeduplicateWorkspacePaths(workspacePaths)
}

// IsMobileWorkspaceBaseDir 判断路径是否为移动端保留的工作空间基目录。
func IsMobileWorkspaceBaseDir(path string) bool {
	if !IsMobileContainer() || "" == path || "" == HomeDir {
		return false
	}
	return filepath.Clean(path) == filepath.Clean(filepath.Dir(HomeDir))
}
