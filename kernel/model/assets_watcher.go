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

//go:build !darwin

package model

import (
	"os"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var assetsWatcher *fsnotify.Watcher

func WatchAssets() {
	if util.IsMobileContainer() {
		return
	}

	go watchAssets()
}

func watchAssets() {
	CloseWatchAssets()
	assetsDir := filepath.Join(util.DataDir, "assets")

	var err error
	assetsWatcher, err = fsnotify.NewWatcher()
	if err != nil {
		logging.LogErrorf("add assets watcher for folder [%s] failed: %s", assetsDir, err)
		return
	}

	if !gulu.File.IsDir(assetsDir) {
		os.MkdirAll(assetsDir, 0755)
	}

	if err = assetsWatcher.Add(assetsDir); err != nil {
		logging.LogErrorf("add assets watcher for folder [%s] failed: %s", assetsDir, err)
		CloseWatchAssets()
		return
	}

	go watchAssetEvents(assetsWatcher)
}

func (batch assetWatchBatch) addFSNotifyEvent(event fsnotify.Event) {
	const changes = fsnotify.Create | fsnotify.Write | fsnotify.Remove | fsnotify.Rename
	if event.Op&(changes|fsnotify.Chmod) != 0 {
		batch.add(event.Name, event.Op&changes != 0)
	}
}

func watchAssetEvents(watcher *fsnotify.Watcher) {
	defer logging.Recover()
	timer := time.NewTimer(100 * time.Millisecond)
	timer.Stop()
	defer timer.Stop()
	batch := assetWatchBatch{}
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			batch.addFSNotifyEvent(event)
			timer.Reset(100 * time.Millisecond)
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			logging.LogErrorf("watch assets failed: %s", err)
		case <-timer.C:
			batch.flush()
			batch = assetWatchBatch{}
		}
	}
}

func CloseWatchAssets() {
	if nil != assetsWatcher {
		assetsWatcher.Close()
		assetsWatcher = nil
	}
}
