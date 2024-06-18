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

var emojisWatcher *fsnotify.Watcher

func WatchEmojis() {
	if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
		return
	}

	go func() {
		watchEmojis()
	}()
}

func watchEmojis() {
	emojisDir := filepath.Join(util.DataDir, "emojis")
	if nil != emojisWatcher {
		emojisWatcher.Close()
	}

	var err error
	if emojisWatcher, err = fsnotify.NewWatcher(); nil != err {
		logging.LogErrorf("add emojis watcher for folder [%s] failed: %s", emojisDir, err)
		return
	}

	go func() {
		defer logging.Recover()

		timer := time.NewTimer(100 * time.Millisecond)
		<-timer.C // timer should be expired at first

		for {
			select {
			case _, ok := <-emojisWatcher.Events:
				if !ok {
					return
				}

				timer.Reset(time.Millisecond * 100)
			case err, ok := <-emojisWatcher.Errors:
				if !ok {
					return
				}
				logging.LogErrorf("watch emojis failed: %s", err)
			case <-timer.C:
				//logging.LogInfof("emojis changed: %s", lastEvent)
				util.PushReloadEmojiConf()
			}
		}
	}()

	if !gulu.File.IsDir(emojisDir) {
		os.MkdirAll(emojisDir, 0755)
	}

	if err = emojisWatcher.Add(emojisDir); err != nil {
		logging.LogErrorf("add emojis watcher for folder [%s] failed: %s", emojisDir, err)
	}
	//logging.LogInfof("added file watcher [%s]", emojisDir)
}

func CloseWatchEmojis() {
	if nil != emojisWatcher {
		emojisWatcher.Close()
	}
}
