package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInitMenuMouseScrollPreference(t *testing.T) {
	const key = "local-menu-mouse-scroll"
	for _, test := range []struct {
		name           string
		confFileExists bool
		notebookCount  int
		readOnly       bool
		storage        string
		wantEnabled    bool
		wantUnchanged  bool
		wantError      bool
	}{
		{name: "new empty workspace", wantEnabled: true},
		{name: "existing empty workspace", confFileExists: true, wantUnchanged: true},
		{name: "existing notebooks without configuration", notebookCount: 1, wantUnchanged: true},
		{name: "readonly workspace", readOnly: true, wantUnchanged: true},
		{name: "explicitly disabled", storage: `{"local-menu-mouse-scroll":false}`, wantUnchanged: true},
		{name: "explicitly enabled", storage: `{"local-menu-mouse-scroll":true}`, wantEnabled: true, wantUnchanged: true},
		{name: "existing enabled workspace", confFileExists: true, storage: `{"local-menu-mouse-scroll":true}`,
			wantEnabled: true, wantUnchanged: true},
		{name: "existing preferences", storage: `{"other-preference":"saved"}`, wantEnabled: true},
		{name: "invalid preference preserved", storage: `{"local-menu-mouse-scroll":"true"}`, wantUnchanged: true},
		{name: "corrupt storage", storage: `{"other-preference":`, wantUnchanged: true, wantError: true},
		{name: "null storage", storage: `null`, wantUnchanged: true, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			previousDataDir, previousReadOnly := util.DataDir, util.ReadOnly
			util.DataDir, util.ReadOnly = t.TempDir(), test.readOnly
			t.Cleanup(func() { util.DataDir, util.ReadOnly = previousDataDir, previousReadOnly })
			storagePath := filepath.Join(util.DataDir, "storage", "local.json")
			if test.storage != "" {
				if err := os.MkdirAll(filepath.Dir(storagePath), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(storagePath, []byte(test.storage), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if err := initMenuMouseScrollPreference(test.confFileExists, test.notebookCount); (err != nil) != test.wantError {
				t.Fatalf("initialization error = %v, wantError %v", err, test.wantError)
			}
			if test.wantUnchanged {
				data, err := os.ReadFile(storagePath)
				if test.storage == "" {
					if !os.IsNotExist(err) {
						t.Fatalf("unexpected storage file or error: %v", err)
					}
				} else if err != nil || !bytes.Equal(data, []byte(test.storage)) {
					t.Fatalf("existing storage changed: %q, error %v", data, err)
				}
			}
			if test.wantError {
				return
			}
			storage, err := getLocalStorageWithError()
			if err != nil {
				t.Fatal(err)
			}
			if enabled, _ := storage[key].(bool); enabled != test.wantEnabled {
				t.Fatalf("enabled = %v, want %v", storage[key], test.wantEnabled)
			}
			if test.name == "existing preferences" && storage["other-preference"] != "saved" {
				t.Fatalf("unrelated preference was lost: %#v", storage)
			}
			if test.wantEnabled && !test.confFileExists {
				if _, err = SetLocalStorageVals(map[string]any{key: false}); err != nil {
					t.Fatal(err)
				}
				if err = initMenuMouseScrollPreference(false, 0); err != nil {
					t.Fatal(err)
				}
				if storage = GetLocalStorage(); storage[key] != false {
					t.Fatalf("initialization overwrote the user's later choice: %#v", storage)
				}
			}
		})
	}
}
