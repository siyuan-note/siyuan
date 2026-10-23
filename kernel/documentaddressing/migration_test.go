package documentaddressing

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/filelock"
)

func structuredReleaseForTest(t *testing.T) {
	t.Helper()
	previous := minimumReaderVersion
	minimumReaderVersion = "0.0.0-test"
	t.Cleanup(func() { minimumReaderVersion = previous })
}

func TestStructuredTitlesAutomaticMigration(t *testing.T) {
	structuredReleaseForTest(t)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	boxDir := filepath.Join(dataDir, testBox)
	original := `{"name":"private title","boxCrypt":{"metadata":"opaque-authenticated-data","wrappedDEK":"original-key"},"future":{"keep":true}}`
	writeTestFile(t, boxDir, ConfigPath, original)
	writeTestFile(t, boxDir, "20261023000001-abcdefg.sy", `{"Spec":"2","Properties":{"title":"existing"}}`)
	before, _ := os.ReadFile(filepath.Join(boxDir, "20261023000001-abcdefg.sy"))
	if err := CheckBox(dataDir, confDir, testBox); err != nil {
		t.Fatal(err)
	}
	snapshot, err := InspectBox(dataDir, confDir, testBox)
	if err != nil || snapshot.Mode != 2 || snapshot.State != "structured" || !snapshot.RecordsConsistent {
		t.Fatal(snapshot, err)
	}
	after, _ := os.ReadFile(filepath.Join(boxDir, "20261023000001-abcdefg.sy"))
	if !bytes.Equal(before, after) {
		t.Fatal("migration rewrote a source document")
	}
	data, _ := os.ReadFile(filepath.Join(boxDir, ConfigPath))
	var got, want map[string]json.RawMessage
	_ = json.Unmarshal(data, &got)
	_ = json.Unmarshal([]byte(original), &want)
	delete(got, "documentAddressingVersion")
	for key, value := range want {
		var a, b bytes.Buffer
		_ = json.Compact(&a, value)
		_ = json.Compact(&b, got[key])
		if !bytes.Equal(a.Bytes(), b.Bytes()) {
			t.Fatalf("changed protected configuration field %s", key)
		}
	}
	store, _ := loadStore(dataDir, confDir)
	if _, err = os.Stat(migrationPath(store, testBox)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("completed migration retained an active journal", err)
	}
	// 旧设备覆盖配置和移除笔记本下界后，本机记录自动恢复投影，不降级也不重写源。
	writeTestFile(t, boxDir, ConfigPath, original)
	if err = os.Remove(filepath.Join(boxDir, FloorPath)); err != nil {
		t.Fatal(err)
	}
	if err = CheckBox(dataDir, confDir, testBox); err != nil {
		t.Fatal(err)
	}
	snapshot, err = InspectBox(dataDir, confDir, testBox)
	if err != nil || snapshot.State != "structured" || !snapshot.RecordsConsistent {
		t.Fatal(snapshot, err)
	}
}

func TestStructuredTitlesMigrationInterruption(t *testing.T) {
	structuredReleaseForTest(t)
	for stage := 1; stage <= 4; stage++ {
		t.Run(fmt.Sprint(stage), func(t *testing.T) {
			root := t.TempDir()
			dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
			writeTestFile(t, filepath.Join(dataDir, testBox), ConfigPath, `{"name":"unchanged"}`)
			store, err := loadStore(dataDir, confDir)
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			injected := errors.New("interrupted after durable write")
			err = migrateBoxRecords(dataDir, testBox, store, func(name string, data []byte) error {
				if err := filelock.WriteFile(name, data); err != nil {
					return err
				}
				calls++
				if calls == stage {
					return injected
				}
				return nil
			})
			if !errors.Is(err, injected) {
				t.Fatal("fault was not reached", err)
			}
			// 下界尚未写入时，保护读取器也必须识别迁移决定并拒绝访问。
			minimumReaderVersion = ""
			if err = CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
				t.Fatal(err)
			}
			minimumReaderVersion = "0.0.0-test"
			if err = CheckBox(dataDir, confDir, testBox); err != nil {
				t.Fatal(err)
			}
			snapshot, err := InspectBox(dataDir, confDir, testBox)
			if err != nil || snapshot.Mode != 2 || snapshot.State != "structured" {
				t.Fatal(snapshot, err)
			}
		})
	}
}

func TestStructuredTitlesMigrationRejectsUnknownAndDeleted(t *testing.T) {
	structuredReleaseForTest(t)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	boxDir := filepath.Join(dataDir, testBox)
	for _, source := range []string{`{"documentAddressingVersion":9}`, `{"documentAddressingVersion":1,"DocumentAddressingVersion":2}`} {
		writeTestFile(t, boxDir, ConfigPath, source)
		if err := CheckBox(dataDir, confDir, testBox); err == nil {
			t.Fatal("unknown or duplicate mode accepted")
		}
		after, _ := os.ReadFile(filepath.Join(boxDir, ConfigPath))
		if string(after) != source {
			t.Fatal("invalid source was overwritten")
		}
	}
	missing := "20261023000009-missing"
	if err := CheckBox(dataDir, confDir, missing); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, missing)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}
