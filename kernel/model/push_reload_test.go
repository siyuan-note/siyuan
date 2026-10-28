// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPluginStorageName(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	tests := []struct {
		name       string
		path       string
		pluginName string
		ok         bool
	}{
		{
			name:       "nested plugin data",
			path:       filepath.Join(util.DataDir, "storage", "petal", "sample", "nested", "data.json"),
			pluginName: "sample",
			ok:         true,
		},
		{
			name:       "plugin storage root",
			path:       filepath.Join(util.DataDir, "storage", "petal", "sample"),
			pluginName: "sample",
			ok:         true,
		},
		{
			name: "petal configuration",
			path: filepath.Join(util.DataDir, "storage", "petal", "petals.json"),
		},
		{
			name: "petal storage root",
			path: filepath.Join(util.DataDir, "storage", "petal"),
		},
		{
			name: "other storage",
			path: filepath.Join(util.DataDir, "storage", "local.json"),
		},
		{
			name: "outside data directory",
			path: filepath.Join(filepath.Dir(util.DataDir), "outside.json"),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pluginName, ok := pluginStorageName(test.path)
			if test.pluginName != pluginName || test.ok != ok {
				t.Fatalf("expected plugin name [%s] and ok [%v], got [%s] and [%v]",
					test.pluginName, test.ok, pluginName, ok)
			}
		})
	}
}
