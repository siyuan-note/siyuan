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

//go:build darwin

package model

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/radovskyb/watcher"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var assetsWatcher *watcher.Watcher

func WatchAssets() {
	go watchAssets()
}

func watchAssets() {
	CloseWatchAssets()
	assetsDir := filepath.Join(util.DataDir, "assets")

	assetsWatcher = watcher.New()

	if !gulu.File.IsDir(assetsDir) {
		os.MkdirAll(assetsDir, 0755)
	}

	if err := assetsWatcher.Add(assetsDir); err != nil {
		logging.LogErrorf("add assets watcher for folder [%s] failed: %s", assetsDir, err)
		return
	}

	go func() {
		defer logging.Recover()

		for {
			select {
			case event, ok := <-assetsWatcher.Event:
				if !ok {
					return
				}

				if strings.HasSuffix(event.Path, ".tmp") {
					continue
				}

				if watcher.Write == event.Op {
					IncSync()
				}

				// 重新缓存资源文件，以便使用 /资源 搜索
				go cache.LoadAssets()

				if watcher.Remove == event.Op {
					HandleAssetsRemoveEvent(event.Path)
				} else {
					HandleAssetsChangeEvent(event.Path)
				}
			case err, ok := <-assetsWatcher.Error:
				if !ok {
					return
				}
				logging.LogErrorf("watch assets failed: %s", err)
			case <-assetsWatcher.Closed:
				return
			}
		}
	}()

	if err := assetsWatcher.Start(10 * time.Second); err != nil {
		logging.LogErrorf("start assets watcher for folder [%s] failed: %s", assetsDir, err)
		return
	}
}

func CloseWatchAssets() {
	if nil != assetsWatcher {
		assetsWatcher.Close()
		assetsWatcher = nil
	}
}
