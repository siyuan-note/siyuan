// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"sync"
	"testing"
)

func TestIndexFixVersionPreservesActivityDuringRepair(t *testing.T) {
	previousVersion, previousClean, previousActivity := indexFixVersion.Load(), indexFixCleanVersion.Load(), lastActivityNs.Load()
	t.Cleanup(func() {
		indexFixVersion.Store(previousVersion)
		indexFixCleanVersion.Store(previousClean)
		lastActivityNs.Store(previousActivity)
	})
	RefreshActivity()
	version := IndexFixVersion()
	var writers sync.WaitGroup
	for range 20 {
		writers.Go(RefreshActivity)
	}
	writers.Wait()
	if MarkIndexClean(version) || !IsIndexFixDirty() {
		t.Fatal("older repair cleared newer changes")
	}
	if !MarkIndexClean(IndexFixVersion()) || IsIndexFixDirty() {
		t.Fatal("successful current repair did not clear pending state")
	}
	MarkIndexFixDirty()
	if !IsIndexFixDirty() {
		t.Fatal("non-editor write did not schedule repair")
	}
}
