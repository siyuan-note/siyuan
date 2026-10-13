package util

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWorkspaceExitMarker(t *testing.T) {
	oldTempDir := TempDir
	TempDir = t.TempDir()
	t.Cleanup(func() { TempDir = oldTempDir })
	marker := filepath.Join(TempDir, workspaceExitFile)
	if err := os.WriteFile(marker, []byte("stale"), 0600); err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()
	clear := MarkWorkspaceExiting()
	data, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Version   int   `json:"version"`
		PID       int   `json:"pid"`
		StartedAt int64 `json:"startedAt"`
	}
	if err = json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	if state.Version != 1 || state.PID != os.Getpid() || state.StartedAt < before {
		t.Fatalf("invalid exit marker: %s", data)
	}
	clear()
	if _, err = os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("marker was not removed: %v", err)
	}
	ClearWorkspaceExitMarker()
}
