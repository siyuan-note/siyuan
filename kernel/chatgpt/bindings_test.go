// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package chatgpt

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestChatGPTBindingsDeviceWorkspaceAndProviderIsolation(t *testing.T) {
	ctx := context.Background()
	workspace, otherWorkspace := t.TempDir(), t.TempDir()
	first, second := Open(t.TempDir()), Open(t.TempDir())
	want := map[string]string{"provider-one": "account-one", "provider-two": "account-two"}
	if err := first.SaveBindings(ctx, workspace, want); err != nil {
		t.Fatal(err)
	}
	if err := first.SaveBindings(ctx, otherWorkspace, map[string]string{"provider-one": "other-workspace"}); err != nil {
		t.Fatal(err)
	}
	if err := second.SaveBindings(ctx, workspace, map[string]string{"provider-one": "other-device"}); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		service *Service
		path    string
		want    map[string]string
	}{
		{Open(first.dir), workspace, want},
		{first, otherWorkspace, map[string]string{"provider-one": "other-workspace"}},
		{second, workspace, map[string]string{"provider-one": "other-device"}},
	} {
		got, err := entry.service.LoadBindings(entry.path)
		if err != nil || !reflect.DeepEqual(got, entry.want) {
			t.Fatalf("bindings = %v, want %v: %v", got, entry.want, err)
		}
	}
	if err := first.SaveBindings(ctx, workspace, map[string]string{"provider-one": "changed-account"}); err != nil {
		t.Fatal(err)
	}
	got, _ := first.LoadBindings(workspace)
	if len(got) != 1 || got["provider-one"] != "changed-account" {
		t.Fatal("removed provider or changed selection was not persisted")
	}
	if err := first.SaveBindings(ctx, workspace, nil); err != nil {
		t.Fatal(err)
	}
	got, err := first.LoadBindings(workspace)
	if err != nil || len(got) != 0 {
		t.Fatal("cleared bindings restored a previous selection")
	}
	for _, name := range []string{"accounts", "key"} {
		if _, err = os.Stat(filepath.Join(first.dir, name)); !os.IsNotExist(err) {
			t.Fatal("binding storage accessed credential files")
		}
	}
}

func TestChatGPTBindingsPreserveInvalidFilesAndCancelledWrites(t *testing.T) {
	s, workspace := Open(t.TempDir()), t.TempDir()
	if _, err := s.LoadBindings(workspace); err != nil {
		t.Fatal(err)
	}
	path, _ := s.BindingPath(workspace)
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatal("reading missing bindings created files")
	}
	want := map[string]string{"provider": "account"}
	if err := s.SaveBindings(context.Background(), workspace, want); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.SaveBindings(ctx, workspace, map[string]string{"provider": "replacement"}); err == nil {
		t.Fatal("cancelled write succeeded")
	}
	got, _ := s.LoadBindings(workspace)
	if !reflect.DeepEqual(got, want) {
		t.Fatal("cancelled write replaced bindings")
	}
	for _, raw := range []string{`{broken`, `{"version":2,"providers":{}}`, `{"version":1,"providers":null}`} {
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := s.LoadBindings(workspace); err == nil {
			t.Fatal("invalid binding file accepted")
		}
		if err := s.SaveBindings(context.Background(), workspace, want); err == nil {
			t.Fatal("invalid binding file overwritten")
		}
		data, _ := os.ReadFile(path)
		if string(data) != raw {
			t.Fatal("invalid binding file was modified")
		}
	}
}
