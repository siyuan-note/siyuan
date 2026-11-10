// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportHeadingNumberPersistAndReset(t *testing.T) {
	prepareConfConsistencyTest(t)
	settingsResetTestEnvironment(t)
	for _, selected := range []bool{true, false} {
		patch, err := json.Marshal(map[string]bool{"headingNumber": selected})
		if err != nil {
			t.Fatal(err)
		}
		for _, raw := range [][]byte{patch, []byte(`{"addTitle":false}`), []byte(`{}`)} {
			if _, err := ApplyConfPatch("export", raw); err != nil {
				t.Fatal(err)
			}
			if *Conf.Export.Load().HeadingNumber != selected {
				t.Fatal("omitted field did not preserve selection")
			}
		}
		data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		if err != nil {
			t.Fatal(err)
		}
		reloaded := NewAppConf()
		if err = json.Unmarshal(data, reloaded); err != nil {
			t.Fatal(err)
		}
		NormalizeAppConf(reloaded)
		if *reloaded.Export.Load().HeadingNumber != selected {
			t.Fatal("selection did not persist")
		}
	}
	if _, err := ApplyConfPatch("export", []byte(`{"headingNumber":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyConfPatch("export", []byte(`{"headingNumber":null}`)); err != nil {
		t.Fatal(err)
	}
	if *Conf.Export.Load().HeadingNumber || Conf.Export.Load().AddTitle {
		t.Fatal("null did not reset only headingNumber")
	}
	if _, err := ApplyConfPatch("export", []byte(`{"headingNumber":true}`)); err != nil {
		t.Fatal(err)
	}
	if err := ResetSettings(); err != nil {
		t.Fatal(err)
	}
	if *Conf.Export.Load().HeadingNumber {
		t.Fatal("settings reset did not restore false")
	}
}
