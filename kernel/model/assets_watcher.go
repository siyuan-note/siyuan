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

//go:build !darwin

package model

import (
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var assetsWatcher *fsnotify.Watcher

func WatchAssets() {
	if "android" == util.Container || "ios" == util.Container {
		return
	}

	go func() {
		watchAssets()
	}()
}

func watchAssets() {
	assetsDir := filepath.Join(util.DataDir, "assets")
	if nil != assetsWatcher {
		assetsWatcher.Close()
	}

	var err error
	if assetsWatcher, err = fsnotify.NewWatcher(); nil != err {
		util.LogErrorf("add assets watcher for folder [%s] failed: %s", assetsDir, err)
		return
	}

	go func() {
		var (
			timer     *time.Timer
			lastEvent fsnotify.Event
		)
		timer = time.NewTimer(100 * time.Millisecond)
		<-timer.C // timer should be expired at first

		for {
			select {
			case event, ok := <-assetsWatcher.Events:
				if !ok {
					return
				}

				lastEvent = event
				timer.Reset(time.Millisecond * 100)
			case err, ok := <-assetsWatcher.Errors:
				if !ok {
					return
				}
				util.LogErrorf("watch assets failed: %s", err)
			case <-timer.C:
				//util.LogInfof("assets changed: %s", lastEvent)
				if lastEvent.Op&fsnotify.Write == fsnotify.Write {
					// 外部修改已有资源文件后纳入云端同步 https://github.com/siyuan-note/siyuan/issues/4694
					IncSync()
				}

				// 重新缓存资源文件，以便使用 /资源 搜索
				cache.LoadAssets()
			}
		}
	}()

	if err = assetsWatcher.Add(assetsDir); err != nil {
		util.LogErrorf("add assets watcher for folder [%s] failed: %s", assetsDir, err)
	}
	//util.LogInfof("added file watcher [%s]", assetsDir)
}

func CloseWatchAssets() {
	if nil != assetsWatcher {
		assetsWatcher.Close()
	}
}
