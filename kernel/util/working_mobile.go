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

	figure "github.com/common-nighthawk/go-figure"
)

func BootMobile(container, appDir, workspaceDir, nativeLibDir, privateDataDir, lang string) {
	IncBootProgress(3, "Booting...")
	rand.Seed(time.Now().UTC().UnixNano())
	initMime()

	HomeDir = filepath.Join(workspaceDir, "home")
	WorkingDir = filepath.Join(appDir, "app")
	WorkspaceDir = workspaceDir
	ConfDir = filepath.Join(workspaceDir, "conf")
	DataDir = filepath.Join(workspaceDir, "data")
	TempDir = filepath.Join(workspaceDir, "temp")
	osTmpDir := filepath.Join(TempDir, "os")
	os.RemoveAll(osTmpDir)
	os.MkdirAll(osTmpDir, 0755)
	os.Setenv("TMPDIR", osTmpDir)
	DBPath = filepath.Join(TempDir, DBName)
	BlockTreePath = filepath.Join(TempDir, "blocktree.msgpack")
	AndroidNativeLibDir = nativeLibDir
	AndroidPrivateDataDir = privateDataDir
	LogPath = filepath.Join(TempDir, "siyuan.log")
	AppearancePath = filepath.Join(ConfDir, "appearance")
	ThemesPath = filepath.Join(AppearancePath, "themes")
	IconsPath = filepath.Join(AppearancePath, "icons")
	Resident = true
	Container = container
	Lang = lang
	initPathDir()
	bootBanner := figure.NewFigure("SiYuan", "", true)
	LogInfof("\n" + bootBanner.String())
	logBootInfo()
}
