package documentaddressing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/siyuan-note/filelock"
)

func readerModeForTest(t *testing.T, mode int) {
	t.Helper()
	previous := defaultMode
	defaultMode = mode
	t.Cleanup(func() { defaultMode = previous })
}

func TestStructuredTitlesDefaultWithoutReaderRelease(t *testing.T) {
	if DefaultMode() != 2 {
		t.Fatal("ordinary builds must enable structured titles")
	}
	previous := minimumReaderVersion
	minimumReaderVersion = ""
	t.Cleanup(func() { minimumReaderVersion = previous })
	if DefaultMode() != 2 || MinimumReaderVersion() != nil {
		t.Fatal("unverified reader release disabled titles or reported a fabricated version")
	}
}

func TestStructuredTitlesAutomaticMigration(t *testing.T) {
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
	readerModeForTest(t, 2)
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
			defaultMode = 1
			if err = CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
				t.Fatal(err)
			}
			defaultMode = 2
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

func TestStructuredTitlesMissingConfigurationRetainsFloor(t *testing.T) {
	readerModeForTest(t, 2)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	boxDir := filepath.Join(dataDir, testBox)
	writeTestFile(t, boxDir, ConfigPath, `{}`)
	if err := CheckBox(dataDir, confDir, testBox); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(boxDir, ConfigPath)); err != nil {
		t.Fatal(err)
	}
	floor, _ := os.ReadFile(filepath.Join(boxDir, FloorPath))
	if mode, err := BoxMode(dataDir, confDir, testBox); err != nil || mode != 2 {
		t.Fatal("missing configuration blocked recovery or lowered the floor", mode, err)
	}
	if _, err := os.Stat(filepath.Join(boxDir, ConfigPath)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("mode inspection created a replacement configuration", err)
	}
	if after, err := os.ReadFile(filepath.Join(boxDir, FloorPath)); err != nil || !bytes.Equal(after, floor) {
		t.Fatal("mode inspection changed the source floor", err)
	}
	snapshot, err := InspectBox(dataDir, confDir, testBox)
	if err != nil || snapshot.State != "recovering" || snapshot.RecordsConsistent {
		t.Fatal("missing configuration was reported as ready", snapshot, err)
	}
	defaultMode = 1
	if err = CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
		t.Fatal("missing configuration bypassed the old reader guard", err)
	}
	defaultMode = 2
	if err = os.RemoveAll(boxDir); err != nil {
		t.Fatal(err)
	}
	if err = CheckBox(dataDir, confDir, testBox); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleted notebook was accepted for recovery", err)
	}
	if _, err = os.Stat(boxDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("mode inspection recreated a deleted notebook", err)
	}
}

func TestStructuredTitlesMigrationProcessRestart(t *testing.T) {
	const rootVariable = "SIYUAN_TEST_TITLE_MIGRATION_ROOT"
	const phaseVariable = "SIYUAN_TEST_TITLE_MIGRATION_PHASE"
	const interruptedExit = 73
	if root := os.Getenv(rootVariable); root != "" {
		dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
		phase := os.Getenv(phaseVariable)
		switch phase {
		case "guard":
			defaultMode = 1
			if err := CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
				t.Fatal("protective reader admitted an interrupted or upgraded notebook", err)
			}
		case "recover":
			if err := CheckBox(dataDir, confDir, testBox); err != nil {
				t.Fatal(err)
			}
			snapshot, err := InspectBox(dataDir, confDir, testBox)
			if err != nil || snapshot.Mode != 2 || !snapshot.RecordsConsistent || snapshot.State != "structured" {
				t.Fatal("fresh process did not finish migration", snapshot, err)
			}
		default:
			stage, err := strconv.Atoi(phase)
			if err != nil || stage < 0 || stage > 4 {
				t.Fatal("invalid interruption stage", phase)
			}
			store, err := loadStore(dataDir, confDir)
			if err != nil {
				t.Fatal(err)
			}
			writes := 0
			err = migrateBoxRecords(dataDir, testBox, store, func(name string, data []byte) error {
				if err := filelock.WriteFile(name, data); err != nil {
					return err
				}
				writes++
				if writes == stage {
					// 已完成的持久写入保留；直接结束进程，禁止清理函数代为完成迁移。
					os.Exit(interruptedExit)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		}
		return
	}

	for stage := 0; stage <= 4; stage++ {
		t.Run(strconv.Itoa(stage), func(t *testing.T) {
			root := t.TempDir()
			boxDir := filepath.Join(root, "data", testBox)
			original := `{"name":"legacy","closed":false,"custom":{"keep":[1,2,3]}}`
			writeTestFile(t, boxDir, ConfigPath, original)
			const document = "20261023000001-abcdefg.sy"
			const source = `{"ID":"20261023000001-abcdefg","Spec":"2","Type":"NodeDocument","Properties":{"id":"20261023000001-abcdefg","title":"Legacy %2F"}}`
			writeTestFile(t, boxDir, document, source)
			writeTestFile(t, boxDir, "assets/retained.bin", "existing attachment")
			run := func(phase string, exitCode int) {
				t.Helper()
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStructuredTitlesMigrationProcessRestart$", "-test.v")
				command.Env = append(os.Environ(), rootVariable+"="+root, phaseVariable+"="+phase)
				output, err := command.CombinedOutput()
				if exitCode == 0 && err == nil {
					return
				}
				var exited *exec.ExitError
				if errors.As(err, &exited) && exited.ExitCode() == exitCode {
					return
				}
				t.Fatalf("phase %s: expected exit %d, got %v\n%s", phase, exitCode, err, output)
			}
			expectedExit := 0
			if stage > 0 {
				expectedExit = interruptedExit
			}
			run(strconv.Itoa(stage), expectedExit)
			run("guard", 0)
			run("recover", 0)
			config, err := os.ReadFile(filepath.Join(boxDir, ConfigPath))
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err = json.Unmarshal(config, &fields); err != nil || string(fields["documentAddressingVersion"]) != "2" {
				t.Fatal("configuration projection was not recovered", err)
			}
			delete(fields, "documentAddressingVersion")
			var wanted map[string]json.RawMessage
			_ = json.Unmarshal([]byte(original), &wanted)
			for key, value := range wanted {
				var compact bytes.Buffer
				if err = json.Compact(&compact, fields[key]); err != nil || !bytes.Equal(value, compact.Bytes()) {
					t.Fatalf("migration changed configuration field %s", key)
				}
			}
			run("recover", 0)
			for name, want := range map[string]string{ConfigPath: string(config), document: source, "assets/retained.bin": "existing attachment"} {
				data, err := os.ReadFile(filepath.Join(boxDir, name))
				if err != nil || string(data) != want {
					t.Fatalf("restart changed %s: %v", name, err)
				}
			}
			journal := filepath.Join(root, "conf", "document-addressing-recovery", testBox+".json")
			if _, err = os.Stat(journal); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("recovered process retained a migration journal", err)
			}
		})
	}
}
