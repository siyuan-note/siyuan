// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"testing"
)

func TestExportHeadingNumberPersistAndReset(t *testing.T) {
	prepareConfConsistencyTest(t)
	settingsResetTestEnvironment(t)
	for _, patch := range []string{`{"headingNumber":false}`, `{"addTitle":false}`, `{}`} {
		if _, err := ApplyConfPatch("export", []byte(patch)); err != nil {
			t.Fatal(err)
		}
		if *Conf.Export.Load().HeadingNumber {
			t.Fatal("omitted field did not preserve false")
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
	if *reloaded.Export.Load().HeadingNumber {
		t.Fatal("false did not persist")
	}
	if _, err = ApplyConfPatch("export", []byte(`{"headingNumber":null}`)); err != nil {
		t.Fatal(err)
	}
	if !*Conf.Export.Load().HeadingNumber || Conf.Export.Load().AddTitle {
		t.Fatal("null did not reset only headingNumber")
	}
	if _, err = ApplyConfPatch("export", []byte(`{"headingNumber":false}`)); err != nil {
		t.Fatal(err)
	}
	if err = ResetSettings(); err != nil {
		t.Fatal(err)
	}
	if !*Conf.Export.Load().HeadingNumber {
		t.Fatal("settings reset did not restore default")
	}
}
