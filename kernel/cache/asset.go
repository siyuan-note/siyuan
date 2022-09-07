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

package cache

import (
	"io/fs"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Asset struct {
	HName   string `json:"hName"`
	Path    string `json:"path"`
	Updated int64  `json:"updated"`
}

var Assets = map[string]*Asset{}
var assetsLock = sync.Mutex{}

func LoadAssets() {
	defer logging.Recover()

	start := time.Now()
	assetsLock.Lock()
	defer assetsLock.Unlock()

	assets := filepath.Join(util.DataDir, "assets")
	filepath.Walk(assets, func(path string, info fs.FileInfo, err error) error {
		if info.IsDir() {
			if strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(info.Name(), ".sya") || strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		hName := util.RemoveID(info.Name())
		path = filepath.ToSlash(strings.TrimPrefix(path, util.DataDir))[1:]
		Assets[path] = &Asset{
			HName:   hName,
			Path:    path,
			Updated: info.ModTime().UnixMilli(),
		}
		return nil
	})
	elapsed := time.Since(start)
	if 2000 < elapsed.Milliseconds() {
		logging.LogInfof("loaded assets [%.2fs]", elapsed.Seconds())
	}
}
