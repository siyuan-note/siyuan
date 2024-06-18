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
	"path/filepath"
	"time"

	"github.com/radovskyb/watcher"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var emojisWatcher *watcher.Watcher

func WatchEmojis() {
	go func() {
		watchEmojis()
	}()
}

func watchEmojis() {
	if nil != emojisWatcher {
		emojisWatcher.Close()
	}
	emojisWatcher = watcher.New()

	emojisDir := filepath.Join(util.DataDir, "emojis")

	go func() {
		for {
			select {
			case event, ok := <-emojisWatcher.Event:
				if !ok {
					return
				}

				//logging.LogInfof("emojis changed: %s", event)
				util.PushReloadEmojiConf()
			case err, ok := <-emojisWatcher.Error:
				if !ok {
					return
				}
				logging.LogErrorf("watch emojis failed: %s", err)
			case <-emojisWatcher.Closed:
				return
			}
		}
	}()

	if err := emojisWatcher.Add(emojisDir); nil != err {
		logging.LogErrorf("add emojis watcher for folder [%s] failed: %s", emojisDir, err)
		return
	}

	//logging.LogInfof("added file watcher [%s]", emojisDir)
	if err := emojisWatcher.Start(10 * time.Second); nil != err {
		logging.LogErrorf("start emojis watcher for folder [%s] failed: %s", emojisDir, err)
		return
	}
}

func CloseWatchEmojis() {
	if nil != emojisWatcher {
		emojisWatcher.Close()
	}
}
