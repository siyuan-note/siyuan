// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package filesys

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLoadTreeHoldsCryptoLeaseThroughCachePublication(t *testing.T) {
	originalDataDir := util.DataDir
	originalProvider := DEKProvider
	originalAcquire := DEKLockAcquire
	originalRelease := DEKLockRelease
	util.DataDir = t.TempDir()
	defer func() {
		cache.ClearTreeCache()
		util.DataDir = originalDataDir
		DEKProvider = originalProvider
		DEKLockAcquire = originalAcquire
		DEKLockRelease = originalRelease
	}()

	boxID := "20260731150000-lease01"
	rootID := "20260731150001-lease02"
	treePath := "/" + rootID + ".sy"
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("content"), luteEngine.ParseOptions)
	tree.Root.ID = rootID
	tree.Root.SetIALAttr("id", rootID)
	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	absPath := filepath.Join(util.DataDir, boxID, treePath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absPath, data, 0600); err != nil {
		t.Fatal(err)
	}

	leaseHeld := false
	cachePublishedAtRelease := false
	DEKProvider = func(string) ([]byte, error) {
		return nil, nil
	}
	DEKLockAcquire = func(string) {
		leaseHeld = true
	}
	DEKLockRelease = func(string) {
		deadline := time.Now().Add(100 * time.Millisecond)
		for !cachePublishedAtRelease && time.Now().Before(deadline) {
			_, cachePublishedAtRelease = cache.GetTreeDataInBox(rootID, boxID)
			time.Sleep(time.Millisecond)
		}
		leaseHeld = false
	}

	loaded, err := LoadTree(boxID, treePath, luteEngine)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Root.ID != rootID {
		t.Fatalf("unexpected loaded tree: %#v", loaded)
	}
	if leaseHeld {
		t.Fatal("crypto lease was not released after loading")
	}
	if !cachePublishedAtRelease {
		t.Fatal("crypto lease was released before plaintext cache publication")
	}
}
