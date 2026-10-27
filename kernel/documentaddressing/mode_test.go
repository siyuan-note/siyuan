// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFixedAddressingVersionDoesNotReadOrWriteRecords(t *testing.T) {
	root := t.TempDir()
	data, conf := filepath.Join(root, "data"), filepath.Join(root, "conf")
	const box = "20261026000000-fixed01"
	for _, existing := range []bool{false, true} {
		if existing {
			if err := os.MkdirAll(filepath.Join(data, box, ".siyuan"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(data, box, ConfigPath), []byte(`{"documentAddressingVersion":999}`), 0600); err != nil {
				t.Fatal(err)
			}
		}
		mode, err := BoxMode(box)
		if err != nil || mode != 2 || DefaultMode() != 2 {
			t.Fatal(mode, err)
		}
		capability, err := InspectBox(box)
		if err != nil || capability.Mode != 2 || capability.State != "structured" {
			t.Fatal(capability, err)
		}
		if _, err := os.Stat(conf); !os.IsNotExist(err) {
			t.Fatal("inspection created local records", err)
		}
		if !existing {
			if _, err := os.Stat(data); !os.IsNotExist(err) {
				t.Fatal("inspection recreated a missing notebook", err)
			}
		} else {
			got, err := os.ReadFile(filepath.Join(data, box, ConfigPath))
			if err != nil || string(got) != `{"documentAddressingVersion":999}` {
				t.Fatal("inspection rewrote a diagnostic marker", err)
			}
		}
	}
	if _, err := BoxMode("../invalid"); err == nil {
		t.Fatal("invalid notebook identity accepted")
	}
}

func TestReplacementPathsRejectAliases(t *testing.T) {
	for _, path := range []string{"../outside", "a//b", "a/../b", "a\\b", "20261026000000-FIXED01/.siyuan/conf.json", "20261026000000-fixed01/.siyuan/CONF.json"} {
		if err := CheckPaths([]string{path}, nil); err == nil {
			t.Fatalf("upsert alias accepted: %q", path)
		}
		if err := CheckPaths(nil, []string{path}); err == nil {
			t.Fatalf("removal alias accepted: %q", path)
		}
	}
}
