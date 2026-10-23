package documentaddressing

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestInspectBoxCapabilities(t *testing.T) {
	root := t.TempDir()
	dataDir, confDir := filepath.Join(root, "data"), filepath.Join(root, "conf")
	first, err := InspectBox(dataDir, confDir, testBox)
	if err != nil || first.Mode != 1 || first.Revision == "" {
		t.Fatal("legacy capability read failed", first, err)
	}
	if _, err = os.Stat(confDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("legacy capability read created a floor record", err)
	}
	boxDir := filepath.Join(dataDir, testBox)
	writeTestFile(t, boxDir, ConfigPath, `{"name":"Private configuration"}`)
	second, err := InspectBox(dataDir, confDir, testBox)
	if err != nil || second.Mode != 1 || second.Revision == first.Revision {
		t.Fatal("configuration changes did not invalidate the revision", err)
	}
	writeTestFile(t, boxDir, FloorPath, `{"version":1,"notebook":"`+testBox+`","minimumMode":2}`)
	third, err := InspectBox(dataDir, confDir, testBox)
	if err != nil || third.Mode != 2 || third.Revision == second.Revision {
		t.Fatal("higher capability was hidden", third, err)
	}
	if err = os.Remove(filepath.Join(boxDir, FloorPath)); err != nil {
		t.Fatal(err)
	}
	fourth, err := InspectBox(dataDir, confDir, testBox)
	if err != nil || fourth.Mode != 2 {
		t.Fatal("capability read forgot the confirmed floor", fourth, err)
	}
	if err = CheckBox(dataDir, confDir, testBox); !errors.Is(err, ErrUnsupported) {
		t.Fatal("capability probe enabled an unsupported writer", err)
	}
	writeTestFile(t, boxDir, FloorPath, `{"version":9}`)
	if _, err = InspectBox(dataDir, confDir, testBox); !errors.Is(err, ErrInvalid) {
		t.Fatal("unknown capability record was hidden", err)
	}
}
