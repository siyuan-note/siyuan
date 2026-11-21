// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetInstalledPackageInfosSharesConcurrentScan(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })

	installPath := filepath.Join(util.DataDir, "plugins", "demo")
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := `{"name":"demo","version":"1.0.0","displayName":{"default":"Demo"}}`
	if err := os.WriteFile(filepath.Join(installPath, "plugin.json"), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}

	oldScan := installedPackageScanFunc
	var mu sync.Mutex
	scans := 0
	installedPackageScanFunc = func(pkgType string) installedPackageScan {
		mu.Lock()
		scans++
		mu.Unlock()
		// 让并发请求在同一轮里重叠，验证只执行一次扫描
		time.Sleep(20 * time.Millisecond)
		return oldScan(pkgType)
	}
	t.Cleanup(func() { installedPackageScanFunc = oldScan })

	const callers = 4
	results := make([][]installedPackageInfo, callers)
	var wg sync.WaitGroup
	for i := range callers {
		wg.Go(func() {
			results[i], _, _, _ = GetInstalledPackageInfos("plugins")
		})
	}
	wg.Wait()

	mu.Lock()
	got := scans
	mu.Unlock()
	if 1 != got {
		t.Fatalf("concurrent requests scanned %d times, want 1", got)
	}
	for _, infos := range results {
		if 1 != len(infos) || "demo" != infos[0].Pkg.Name {
			t.Fatalf("unexpected scan result: %#v", infos)
		}
	}

	// 每个调用方拿到独立副本，就地写入展示字段不会影响其他请求
	results[0][0].Pkg.DisplayName["default"] = "mutated"
	if "Demo" != results[1][0].Pkg.DisplayName["default"] {
		t.Fatal("concurrent callers shared the same package object")
	}
}
