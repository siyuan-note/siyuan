package documentaddressing

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

const testBox = "20260101120000-abcdefg"

func writeTestFile(t *testing.T, directory, name, data string) {
	t.Helper()
	name = filepath.Join(directory, name)
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestReadMode(t *testing.T) {
	for _, tc := range []struct {
		name, config, floor string
		mode                int
		invalid             bool
	}{
		{name: "missing", mode: 1},
		{name: "legacy", config: `{"name":"legacy"}`, mode: 1},
		{name: "explicit legacy", config: `{"documentAddressingVersion":1}`, mode: 1},
		{name: "structured", config: `{"documentAddressingVersion":2}`, mode: 2},
		{name: "future", config: `{"documentAddressingVersion":99}`, mode: 99},
		{name: "case folding", config: `{"DocumentAddressingVersion":2}`, mode: 2},
		{name: "escaped field", config: `{"documentAddressing\u0056ersion":2}`, mode: 2},
		{name: "nested field is unrelated", config: `{"boxCrypt":{"documentAddressingVersion":2}}`, mode: 1},
		{name: "floor", config: `{}`, floor: `{"version":1,"notebook":"` + testBox + `","minimumMode":2}`, mode: 2},
		{name: "maximum", config: `{"documentAddressingVersion":3}`, floor: `{"version":1,"notebook":"` + testBox + `","minimumMode":2}`, mode: 3},
		{name: "duplicate", config: `{"documentAddressingVersion":2,"documentAddressingVersion":1}`, invalid: true},
		{name: "duplicate case", config: `{"documentAddressingVersion":2,"DocumentAddressingVersion":1}`, invalid: true},
		{name: "null", config: `{"documentAddressingVersion":null}`, invalid: true},
		{name: "string", config: `{"documentAddressingVersion":"2"}`, invalid: true},
		{name: "zero", config: `{"documentAddressingVersion":0}`, invalid: true},
		{name: "negative", config: `{"documentAddressingVersion":-1}`, invalid: true},
		{name: "fraction", config: `{"documentAddressingVersion":1.5}`, invalid: true},
		{name: "trailing data", config: `{} {}`, invalid: true},
		{name: "not an object", config: `null`, invalid: true},
		{name: "truncated config", config: `{"name":"sensitive`, invalid: true},
		{name: "unknown record", floor: `{"version":2,"notebook":"` + testBox + `","minimumMode":2}`, invalid: true},
		{name: "missing mode", floor: `{"version":1,"notebook":"` + testBox + `"}`, invalid: true},
		{name: "foreign identity", floor: `{"version":1,"notebook":"20260101120000-hijklmn","minimumMode":2}`, invalid: true},
		{name: "unknown record field", floor: `{"version":1,"notebook":"` + testBox + `","minimumMode":2,"extra":true}`, invalid: true},
		{name: "duplicate record mode", floor: `{"version":1,"notebook":"` + testBox + `","minimumMode":2,"minimumMode":1}`, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mode, err := ReadMode(testBox, func(name string) ([]byte, error) {
				value := tc.config
				if name == FloorPath {
					value = tc.floor
				}
				if value == "" {
					return nil, os.ErrNotExist
				}
				return []byte(value), nil
			})
			if tc.invalid {
				if !errors.Is(err, ErrInvalid) || err.Error() != ErrInvalid.Error() {
					t.Fatalf("expected safe metadata error, got %v", err)
				}
			} else if err != nil || mode != tc.mode {
				t.Fatalf("got mode %d, error %v", mode, err)
			}
		})
	}
}

func TestCheckBoxPreservesSourcesAndNeverLowersFloor(t *testing.T) {
	readerModeForTest(t, 1)
	for _, marker := range []string{"config", "floor"} {
		t.Run(marker, func(t *testing.T) {
			root := t.TempDir()
			dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
			boxDir := filepath.Join(dataDir, testBox)
			config := `{"documentAddressingVersion":2,"name":"private"}`
			if marker == "floor" {
				config = `{}`
				writeTestFile(t, boxDir, FloorPath, `{"version":1,"notebook":"`+testBox+`","minimumMode":2}`)
			}
			writeTestFile(t, boxDir, ConfigPath, config)
			for i := 0; i < 3; i++ {
				if err := CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
					t.Fatalf("check %d: %v", i, err)
				}
				if i == 0 {
					actual, err := os.ReadFile(filepath.Join(boxDir, ConfigPath))
					if err != nil || string(actual) != config {
						t.Fatal("source config changed")
					}
					writeTestFile(t, boxDir, ConfigPath, `{}`)
					if marker == "floor" {
						if err := os.Remove(filepath.Join(boxDir, FloorPath)); err != nil {
							t.Fatal(err)
						}
					}
				} else if i == 1 {
					if err := os.Remove(filepath.Join(boxDir, ConfigPath)); err != nil {
						t.Fatal(err)
					}
				}
			}
			data, err := os.ReadFile(filepath.Join(confDir, "document-addressing.json"))
			var stored localStore
			if err != nil || json.Unmarshal(data, &stored) != nil || stored.Notebooks[testBox] != 2 {
				t.Fatalf("floor not retained: %s, %v", data, err)
			}
			if _, err := os.Stat(filepath.Join(boxDir, ConfigPath)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("missing config repaired: %v", err)
			}
		})
	}
}

func TestLegacyReaderDoesNotMigrateData(t *testing.T) {
	readerModeForTest(t, 1)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	writeTestFile(t, dataDir, testBox+"/"+ConfigPath, `{"name":"legacy"}`)
	if err := CheckBox(dataDir, confDir, testBox); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(confDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected migration: %v", err)
	}
}

func TestCheckBoxPreservesInvalidLocalFloor(t *testing.T) {
	for _, data := range []string{
		`{"version":2,"notebooks":{}}`,
		`{"version":1,"notebooks":null}`,
		`{"version":1,"notebooks":{"` + testBox + `":2,"` + testBox + `":1}}`,
		`{"version":1,"notebooks":{"` + testBox + `":0}}`,
		`{"version":1,"notebooks":{"other":2}}`,
		`{`,
	} {
		t.Run(data, func(t *testing.T) {
			root := t.TempDir()
			dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
			writeTestFile(t, confDir, "document-addressing.json", data)
			writeTestFile(t, dataDir, testBox+"/"+ConfigPath, `{"documentAddressingVersion":2}`)
			if err := CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrInvalid) {
				t.Fatal(err)
			}
			actual, err := os.ReadFile(filepath.Join(confDir, "document-addressing.json"))
			if err != nil || !bytes.Equal(actual, []byte(data)) {
				t.Fatal("invalid local floor overwritten")
			}
		})
	}
}

func TestCheckBatchUsesIncomingModeAndRetainsObservedFloor(t *testing.T) {
	readerModeForTest(t, 1)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	config := testBox + "/" + ConfigPath
	writeTestFile(t, dataDir, config, `{}`)
	err := CheckBatch(dataDir, confDir, []string{config, testBox + "/new.sy"}, nil, func(name string) ([]byte, error) {
		if name != config {
			t.Fatalf("unexpected read %s", name)
		}
		return []byte(`{"documentAddressingVersion":2}`), nil
	})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dataDir, config))
	if err != nil || string(data) != `{}` {
		t.Fatal("preflight changed source")
	}
	if err = CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("rejected incoming floor forgotten: %v", err)
	}
}

func TestCheckBatchAllowsOnlyWholeNotebookDeletion(t *testing.T) {
	readerModeForTest(t, 1)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	config, doc := testBox+"/"+ConfigPath, testBox+"/document.sy"
	writeTestFile(t, dataDir, config, `{"documentAddressingVersion":2}`)
	writeTestFile(t, dataDir, doc, "source")
	read := func(string) ([]byte, error) { t.Fatal("unexpected incoming file"); return nil, nil }
	if err := CheckBatch(dataDir, confDir, nil, []string{config}, read); !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
	if err := CheckBatch(dataDir, confDir, nil, []string{config, doc}, read); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(dataDir, testBox)); err != nil {
		t.Fatal(err)
	}
	if err := CheckBatch(dataDir, confDir, nil, []string{config, doc}, read); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, testBox)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleted notebook recreated")
	}
	writeTestFile(t, dataDir, config, `{}`)
	if err := CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("restored identity lost floor: %v", err)
	}
}

func TestCheckBatchCannotEraseAnUnobservedFloor(t *testing.T) {
	readerModeForTest(t, 1)
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	config, floor := testBox+"/"+ConfigPath, testBox+"/"+FloorPath
	writeTestFile(t, dataDir, config, `{}`)
	writeTestFile(t, dataDir, floor, `{"version":1,"notebook":"`+testBox+`","minimumMode":2}`)
	err := CheckBatch(dataDir, confDir, []string{config}, []string{floor}, func(string) ([]byte, error) { return []byte(`{}`), nil })
	if !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(dataDir, floor)); err != nil {
		t.Fatal(err)
	}
}

func TestReadModePreservesIOErrors(t *testing.T) {
	want := errors.New("source unavailable")
	_, err := ReadMode(testBox, func(string) ([]byte, error) { return nil, want })
	if !errors.Is(err, want) {
		t.Fatal(err)
	}
}

func TestCheckImportUsesConfirmedSourceFloorWithoutAdoptingNewIdentities(t *testing.T) {
	readerModeForTest(t, 1)
	root, source := t.TempDir(), t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	writeTestFile(t, source, ConfigPath, `{"documentAddressingVersion":2}`)
	if err := CheckImport(dataDir, confDir, testBox, source); !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(confDir, "document-addressing.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("rejected standalone source identity was adopted")
	}
	writeTestFile(t, confDir, "document-addressing.json", `{"version":1,"notebooks":{"`+testBox+`":2}}`)
	writeTestFile(t, source, ConfigPath, `{}`)
	if err := CheckImport(dataDir, confDir, testBox, source); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("identity remapping could downgrade a known source: %v", err)
	}
}

func TestCheckBatchRejectsPathAliases(t *testing.T) {
	for _, name := range []string{
		"../" + testBox + "/" + ConfigPath,
		testBox + "/.siyuan/../.siyuan/conf.json",
		testBox + "/.siyuan/CONF.JSON",
		testBox + "/.SIYUAN/document-addressing.json",
		"20260101120000-ABCDEFG/" + ConfigPath,
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			err := CheckBatch(filepath.Join(root, "data"), filepath.Join(root, "conf"), []string{name}, nil,
				func(string) ([]byte, error) { t.Fatal("invalid path reached snapshot reader"); return nil, nil })
			if !errors.Is(err, ErrInvalid) {
				t.Fatal(err)
			}
		})
	}
}
