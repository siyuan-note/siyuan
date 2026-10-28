// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if util.IsMobileContainer() {
		return
	}

	go watchEmojis()
}

func watchEmojis() {
	CloseWatchEmojis()
	emojisDir := filepath.Join(util.DataDir, "emojis")

	var err error
	emojisWatcher, err = fsnotify.NewWatcher()
	if err != nil {
		logging.LogErrorf("add emojis watcher for folder [%s] failed: %s", emojisDir, err)
		return
	}

	if !gulu.File.IsDir(emojisDir) {
		os.MkdirAll(emojisDir, 0755)
	}

	if err = emojisWatcher.Add(emojisDir); err != nil {
		logging.LogErrorf("add emojis watcher for folder [%s] failed: %s", emojisDir, err)
		CloseWatchEmojis()
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
				util.PushReloadEmojiConf()
			}
		}
	}()
}

func CloseWatchEmojis() {
	if nil != emojisWatcher {
		emojisWatcher.Close()
		emojisWatcher = nil
	}
}
