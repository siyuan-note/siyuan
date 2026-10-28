// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin

package model

import (
	"errors"
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

	recovery := newAssetWatchRecovery(assetsWatcher, assetsDir)
	go watchAssetEvents(assetsWatcher, recovery)
}

func (batch assetWatchBatch) addFSNotifyEvent(event fsnotify.Event) {
	const changes = fsnotify.Create | fsnotify.Write | fsnotify.Remove | fsnotify.Rename
	if event.Op&(changes|fsnotify.Chmod) != 0 {
		batch.add(event.Name, event.Op&changes != 0)
	}
}

func watchAssetEvents(watcher *fsnotify.Watcher, recovery *assetWatchRecovery) {
	defer logging.Recover()
	processAssetWatchEventsWithRecovery(watcher.Events, watcher.Errors, func(batch assetWatchBatch) {
		recovery.remember(batch)
		batch.flush()
	}, recovery.recover)
}

func processAssetWatchEvents(events <-chan fsnotify.Event, errors <-chan error, flush func(assetWatchBatch)) {
	processAssetWatchEventsWithRecovery(events, errors, flush, nil)
}

func processAssetWatchEventsWithRecovery(events <-chan fsnotify.Event, watchErrors <-chan error, flush func(assetWatchBatch), recoverWatch func(bool) (assetWatchBatch, error)) {
	timer := time.NewTimer(100 * time.Millisecond)
	timer.Stop()
	defer timer.Stop()
	deadline := time.NewTimer(time.Second)
	deadline.Stop()
	defer deadline.Stop()
	batch := assetWatchBatch{}
	var recoveryTicks <-chan time.Time
	if recoverWatch != nil {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		recoveryTicks = ticker.C
	}
	flushBatch := func() {
		timer.Stop()
		deadline.Stop()
		flush(batch)
		batch = assetWatchBatch{}
	}
	recoverBatch := func(overflow bool) {
		recovered, err := recoverWatch(overflow)
		if err != nil {
			if !os.IsNotExist(err) {
				logging.LogErrorf("recover assets watcher failed: %s", err)
			}
			return
		}
		if recovered == nil {
			return
		}
		for name, changed := range recovered {
			batch.add(name, changed)
		}
		flushBatch()
	}
	for {
		select {
		case event, ok := <-events:
			if !ok {
				return
			}
			empty := len(batch) == 0
			batch.addFSNotifyEvent(event)
			if len(batch) > 0 {
				if empty {
					// Bound batch latency even when another path never becomes idle.
					deadline.Reset(time.Second)
				}
				timer.Reset(100 * time.Millisecond)
			}
		case err, ok := <-watchErrors:
			if !ok {
				return
			}
			logging.LogErrorf("watch assets failed: %s", err)
			if recoverWatch != nil && errors.Is(err, fsnotify.ErrEventOverflow) {
				recoverBatch(true)
			}
		case <-recoveryTicks:
			recoverBatch(false)
		case <-timer.C:
			flushBatch()
		case <-deadline.C:
			flushBatch()
		}
	}
}

func CloseWatchAssets() {
	if nil != assetsWatcher {
		assetsWatcher.Close()
		assetsWatcher = nil
	}
}
