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

//go:build darwin

package model

import (
	"os"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	"github.com/radovskyb/watcher"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var assetsWatcher *watcher.Watcher

func WatchAssets() {
	if util.IsMobileContainer() {
		return
	}

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

	watcherInstance := assetsWatcher
	go func() {
		defer logging.Recover()

		for {
			select {
			case event, ok := <-watcherInstance.Event:
				if !ok {
					return
				}

				batch := assetWatchBatch{}
				batch.addDarwinEvent(event)
				batch.flush()
			case err, ok := <-watcherInstance.Error:
				if !ok {
					return
				}
				logging.LogErrorf("watch assets failed: %s", err)
			case <-watcherInstance.Closed:
				return
			}
		}
	}()

	if err := watcherInstance.Start(10 * time.Second); err != nil {
		logging.LogErrorf("start assets watcher for folder [%s] failed: %s", assetsDir, err)
		return
	}
}

func (batch assetWatchBatch) addDarwinEvent(event watcher.Event) {
	switch event.Op {
	case watcher.Create, watcher.Write, watcher.Remove:
		batch.add(event.Path, true)
	case watcher.Rename, watcher.Move:
		batch.add(event.OldPath, true)
		batch.add(event.Path, true)
	case watcher.Chmod:
		batch.add(event.Path, false)
	}
}

func CloseWatchAssets() {
	if nil != assetsWatcher {
		assetsWatcher.Close()
		assetsWatcher = nil
	}
}
