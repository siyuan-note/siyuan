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
	"math/rand"
	"os"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	figure "github.com/common-nighthawk/go-figure"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

func BootMobile(container, appDir, workspaceDir, nativeLibDir, privateDataDir, lang string) {
	IncBootProgress(3, "Booting...")
	rand.Seed(time.Now().UTC().UnixNano())
	initMime()

	HomeDir = filepath.Join(workspaceDir, "home")
	userHomeConfDir := filepath.Join(HomeDir, ".config", "siyuan")
	if !gulu.File.IsExist(userHomeConfDir) {
		os.MkdirAll(userHomeConfDir, 0755)
	}
	WorkingDir = filepath.Join(appDir, "app")
	WorkspaceDir = workspaceDir
	ConfDir = filepath.Join(workspaceDir, "conf")
	DataDir = filepath.Join(workspaceDir, "data")
	HistoryDir = filepath.Join(workspaceDir, "history")
	RepoDir = filepath.Join(WorkspaceDir, "repo")
	TempDir = filepath.Join(workspaceDir, "temp")
	osTmpDir := filepath.Join(TempDir, "os")
	os.RemoveAll(osTmpDir)
	os.MkdirAll(osTmpDir, 0755)
	os.RemoveAll(filepath.Join(TempDir, "repo"))
	os.Setenv("TMPDIR", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	HistoryDBPath = filepath.Join(TempDir, "history.db")
	BlockTreePath = filepath.Join(TempDir, "blocktree.msgpack")
	AndroidNativeLibDir = nativeLibDir
	AndroidPrivateDataDir = privateDataDir
	LogPath = filepath.Join(TempDir, "siyuan.log")
	logging.SetLogPath(LogPath)
	AppearancePath = filepath.Join(ConfDir, "appearance")
	ThemesPath = filepath.Join(AppearancePath, "themes")
	IconsPath = filepath.Join(AppearancePath, "icons")
	Resident = true
	Container = container
	UserAgent = UserAgent + " " + Container
	httpclient.SetUserAgent(UserAgent)
	Lang = lang
	initPathDir()
	bootBanner := figure.NewFigure("SiYuan", "", true)
	logging.LogInfof("\n" + bootBanner.String())
	logBootInfo()
}
