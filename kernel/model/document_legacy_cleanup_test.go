package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

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

func TestFixedDocumentAddressingMarkerPersists(t *testing.T) {
	fixture := setupFileOperationTest(t)
	name := filepath.Join(util.DataDir, fixture.box.ID, documentaddressing.ConfigPath)
	configuration := fixture.box.GetConf()
	if err := fixture.box.SaveConf(configuration); err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	data, err := os.ReadFile(name)
	if err != nil || json.Unmarshal(data, &fields) != nil || string(fields["documentAddressingVersion"]) != "2" {
		t.Fatal("configuration lost fixed addressing marker", err)
	}
}
