// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRetiredDocumentAddressingCleanupRespectsReadOnly(t *testing.T) {
	previousConf, previousReadOnly := util.ConfDir, util.ReadOnly
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir, util.ReadOnly = previousConf, previousReadOnly })
	file := filepath.Join(util.ConfDir, "document-addressing.json")
	if err := os.WriteFile(file, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	util.ReadOnly = true
	if err := cleanupRetiredDocumentAddressing(); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "original" {
		t.Fatal("read-only startup changed workspace", err)
	}
	util.ReadOnly = false
	if err := cleanupRetiredDocumentAddressing(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("startup did not retire local record", err)
	}
}

func TestRetiredDocumentAddressingMarkerIsNotPersisted(t *testing.T) {
	fixture := setupFileOperationTest(t)
	name := filepath.Join(util.DataDir, fixture.box.ID, documentaddressing.ConfigPath)
	configuration := fixture.box.GetConf()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	fields["documentAddressingVersion"] = json.RawMessage("999")
	data, err = json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := fixture.box.SaveConf(configuration); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(name)
	fields = nil
	if err != nil || json.Unmarshal(data, &fields) != nil || fields["documentAddressingVersion"] != nil {
		t.Fatal("configuration retained retired addressing marker", err)
	}
	modified := time.Unix(1700000000, 0)
	if err = os.Chtimes(name, modified, modified); err != nil {
		t.Fatal(err)
	}
	if err = fixture.box.SaveConf(configuration); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(name)
	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("unchanged save changed configuration bytes", err)
	}
	if info, err := os.Stat(name); err != nil || !info.ModTime().Equal(modified) {
		t.Fatal("unchanged save rewrote configuration", err)
	}
}
