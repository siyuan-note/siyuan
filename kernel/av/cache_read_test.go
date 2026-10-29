// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseAttributeViewRejectsStaleDiskRead(t *testing.T) {
	previousDir, previousProvider := util.DataDir, AVDEKProvider
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir, AVDEKProvider = previousDir, previousProvider
		cache.ClearAVCache()
	})
	cache.ClearAVCache()
	const id, box = "20261027000000-abcdefg", "20261027000001-abcdefg"
	path := filepath.Join(util.DataDir, box, "storage", "av", id+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	old := []byte(`{"id":"` + id + `","name":"old","keyValues":[],"views":[]}`)
	current := []byte(`{"id":"` + id + `","name":"current","keyValues":[],"views":[]}`)
	if err := os.WriteFile(path, old, 0600); err != nil {
		t.Fatal(err)
	}
	// This callback runs after the old bytes are read, before their publication.
	// Publish a newer disk/cache state at that boundary without timing a race.
	AVDEKProvider = func(string) ([]byte, error) {
		if err := os.WriteFile(path, current, 0600); err != nil {
			return nil, err
		}
		cache.SetAVDataInBox(id, box, current)
		return nil, nil
	}
	if _, err := parseAttributeViewByPathInBoxWithOptions(path, box, false); err != nil {
		t.Fatal(err)
	}
	AVDEKProvider = nil
	deadline := time.Now().Add(time.Second)
	for {
		if raw, ok := cache.GetAVDataInBox(id, box); ok {
			if string(raw) != string(current) {
				t.Fatalf("old disk read replaced the newer cache: %s", raw)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("newer cache admission did not complete")
		}
		time.Sleep(time.Millisecond)
	}
	view, err := parseAttributeViewByPathInBoxWithOptions(path, box, false)
	if err != nil || view.Name != "current" {
		t.Fatalf("subsequent parse restored stale data: %v, %v", view, err)
	}
}
