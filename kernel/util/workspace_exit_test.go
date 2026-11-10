// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
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
	marked := MarkWorkspaceExiting()
	created, err := workspaceExitProcessStart(context.Background(), os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	var state WorkspaceExitState
	if err = json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	if state.Version != 2 || state.PID != os.Getpid() || state.StartedAt < before || state.Phase != "exiting" || state.Port != ServerPort {
		t.Fatalf("invalid exit marker: %s", data)
	}
	if state.ProcessStartedAt != created || created <= 0 {
		t.Fatalf("process identity lost: %s", data)
	}
	marked.SetPhase("waiting")
	data, err = os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	if state.Phase != "waiting" || state.StartedAt != marked.StartedAt || state.ProcessStartedAt != created {
		t.Fatalf("exit batch lost: %s", data)
	}
	ClearWorkspaceExitMarker()
	if _, err = os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("marker was not removed: %v", err)
	}
	ClearWorkspaceExitMarker()
}
