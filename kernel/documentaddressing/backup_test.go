package documentaddressing

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestBackupRetainsMaximumRequirements(t *testing.T) {
	confDir := t.TempDir()
	name := filepath.Join(confDir, "document-addressing.json")
	old := []byte(`{"documentAddressing":{"version":1,"notebooks":{"20261022120000-noteb01":2}}}`)
	newer := []byte(`{"documentAddressing":{"version":1,"notebooks":{"20261022120000-noteb01":3,"20261022120000-noteb02":2}}}`)
	for _, data := range [][]byte{old, newer, old, []byte(`{"editor":{}}`)} {
		if err := RestoreBackup(confDir, data); err != nil {
			t.Fatal(err)
		}
	}
	source, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	record, err := parseStore(source)
	if err != nil || record["20261022120000-noteb01"] != 3 || record["20261022120000-noteb02"] != 2 {
		t.Fatalf("capability requirements were lost: %s, %v", source, err)
	}
	backup, err := ExportBackup(confDir, []byte(`{"editor":{"fontSize":16}}`))
	if err != nil {
		t.Fatal(err)
	}
	restoredDir := t.TempDir()
	if err = RestoreBackup(restoredDir, backup); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(filepath.Join(restoredDir, "document-addressing.json"))
	if err != nil || !bytes.Equal(restored, source) {
		t.Fatalf("backup did not preserve requirements: %s, %v", restored, err)
	}
	for _, invalid := range []string{
		`{"documentAddressing":null}`,
		`{"documentAddressing":{"version":2,"notebooks":{}}}`,
		`{"documentAddressing":{"version":1,"notebooks":{"invalid":2}}}`,
		`{"documentAddressing":{"version":1,"notebooks":{}},"DocumentAddressing":{}}`,
	} {
		if err = RestoreBackup(confDir, []byte(invalid)); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid backup accepted: %s, %v", invalid, err)
		}
		after, _ := os.ReadFile(name)
		if !bytes.Equal(after, source) {
			t.Fatal("invalid backup changed the local record")
		}
	}
	if err = os.WriteFile(name, []byte(`{"version":99}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = ExportBackup(confDir, []byte(`{}`)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid local record exported: %v", err)
	}
	if err = RestoreBackup(confDir, old); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid local record overwritten: %v", err)
	}
	unchanged, _ := os.ReadFile(name)
	if string(unchanged) != `{"version":99}` {
		t.Fatal("invalid local record changed")
	}
}

func TestBackupDoesNotMigrateLegacySettings(t *testing.T) {
	confDir := t.TempDir()
	data := []byte(`{"editor":{"fontSize":16}}`)
	backup, err := ExportBackup(confDir, data)
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("legacy export changed: %s, %v", backup, err)
	}
	if err = RestoreBackup(confDir, backup); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(confDir)
	if len(entries) != 0 {
		t.Fatal("legacy settings created a capability record")
	}
}
