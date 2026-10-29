// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func agentInstructionsTestDir(t *testing.T) {
	t.Helper()
	previous := DataDir
	DataDir = t.TempDir()
	t.Cleanup(func() { DataDir = previous })
}

func TestAgentInstructionsStorage(t *testing.T) {
	agentInstructionsTestDir(t)
	missing, err := ReadAgentInstructions()
	if err != nil || missing.Content != "" || missing.Revision != "missing" {
		t.Fatalf("missing: %+v %v", missing, err)
	}
	if _, err = os.Stat(filepath.Dir(AgentInstructionsPath())); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("read created storage")
	}
	if AgentInstructionsPath() != filepath.Join(DataDir, "storage", "ai", "AGENTS.md") {
		t.Fatal("instructions must share the AI storage directory")
	}
	content := "\ufeffUse citations.\r\n保留原文\r\n"
	saved, migrated, err := SaveAgentInstructions(content, missing.Revision)
	if err != nil || migrated {
		t.Fatalf("new save reported migration: %v %v", migrated, err)
	}
	read, err := ReadAgentInstructions()
	if err != nil || read != saved || read.Content != content {
		t.Fatalf("round trip: %+v %v", read, err)
	}
	for _, revision := range []string{"", "missing", "stale"} {
		if _, _, err = SaveAgentInstructions("lost update", revision); !errors.Is(err, ErrAgentInstructionsConflict) {
			t.Fatalf("accepted revision %q: %v", revision, err)
		}
	}
	empty, _, err := SaveAgentInstructions("", saved.Revision)
	if err != nil || empty.Revision == missing.Revision {
		t.Fatalf("empty file: %+v %v", empty, err)
	}
	if read, err = ReadAgentInstructions(); err != nil || read != empty {
		t.Fatalf("empty round trip: %+v %v", read, err)
	}
	if _, _, err = SaveAgentInstructions(strings.Repeat("a", MaxAgentInstructionsSize), empty.Revision); err != nil {
		t.Fatal(err)
	}
	maxContent, err := ReadAgentInstructions()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = SaveAgentInstructions(strings.Repeat("界", 11000), maxContent.Revision); !errors.Is(err, ErrAgentInstructionsTooLarge) {
		t.Fatalf("UTF-8 byte limit not enforced: %v", err)
	}
	if unchanged, err := ReadAgentInstructions(); err != nil || unchanged != maxContent {
		t.Fatalf("invalid save modified source: %+v %v", unchanged, err)
	}
}

func TestAgentInstructionsPreservesInvalidSource(t *testing.T) {
	agentInstructionsTestDir(t)
	if err := os.MkdirAll(filepath.Dir(AgentInstructionsPath()), 0755); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{strings.Repeat("a", MaxAgentInstructionsSize+1), "\xff\xfe", "\x00", "\x01"} {
		if err := os.WriteFile(AgentInstructionsPath(), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadAgentInstructions(); err == nil {
			t.Fatal("accepted invalid source")
		}
		if _, _, err := SaveAgentInstructions("replacement", "missing"); err == nil {
			t.Fatal("overwrote invalid source")
		}
		actual, err := os.ReadFile(AgentInstructionsPath())
		if err != nil || string(actual) != content {
			t.Fatal("invalid source lost")
		}
	}
}

func TestAgentInstructionsConcurrentSave(t *testing.T) {
	agentInstructionsTestDir(t)
	initial, _, err := SaveAgentInstructions("initial", "missing")
	if err != nil {
		t.Fatal(err)
	}
	errorsCh := make(chan error, 2)
	var wait sync.WaitGroup
	for _, value := range []string{"first", "second"} {
		wait.Go(func() { _, _, err := SaveAgentInstructions(value, initial.Revision); errorsCh <- err })
	}
	wait.Wait()
	close(errorsCh)
	success, conflicts := 0, 0
	for err := range errorsCh {
		if err == nil {
			success++
		} else if errors.Is(err, ErrAgentInstructionsConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d", success, conflicts)
	}
	files, err := os.ReadDir(filepath.Dir(AgentInstructionsPath()))
	if err != nil || len(files) != 1 || files[0].Name() != "AGENTS.md" {
		t.Fatalf("temporary file leaked: %v %v", files, err)
	}
}

func TestAgentInstructionsRejectsLinks(t *testing.T) {
	for _, rel := range []string{"storage", "storage/ai", "storage/ai/AGENTS.md", "ai", "ai/AGENTS.md"} {
		t.Run(rel, func(t *testing.T) {
			agentInstructionsTestDir(t)
			outside := t.TempDir()
			link := filepath.Join(DataDir, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
				t.Fatal(err)
			}
			target := outside
			if filepath.Ext(rel) == ".md" {
				target = filepath.Join(outside, "AGENTS.md")
				if err := os.WriteFile(target, []byte("outside"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.Symlink(target, link); err != nil {
				if runtime.GOOS != "windows" || target != outside {
					t.Skipf("symlinks unavailable: %v", err)
				}
				if output, junctionErr := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); junctionErr != nil {
					t.Skipf("directory links unavailable: %v %s", junctionErr, output)
				}
			}
			if _, err := ReadAgentInstructions(); err == nil {
				t.Fatal("followed storage link")
			}
			if _, _, err := SaveAgentInstructions("escape", "missing"); err == nil {
				t.Fatal("wrote through storage link")
			}
			if target == outside {
				entries, err := os.ReadDir(outside)
				if err != nil || len(entries) != 0 {
					t.Fatalf("storage link modified its target: %v %v", entries, err)
				}
			}
		})
	}
}

func writeAgentInstructionsFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestAgentInstructionsLegacyMigration(t *testing.T) {
	for _, content := range []string{"", "\ufeffKeep citations.\r\n保留原文\r\n"} {
		t.Run(fmt.Sprintf("bytes=%d", len(content)), func(t *testing.T) {
			agentInstructionsTestDir(t)
			legacy := LegacyAgentInstructionsPath()
			writeAgentInstructionsFixture(t, legacy, content)
			before, err := os.Stat(legacy)
			if err != nil {
				t.Fatal(err)
			}
			read, err := ReadAgentInstructions()
			if err != nil || read.Content != content || read.Revision == "missing" {
				t.Fatalf("legacy read: %+v %v", read, err)
			}
			if _, err = os.Stat(AgentInstructionsPath()); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("read migrated the source: %v", err)
			}
			if _, _, err = SaveAgentInstructions("invalid revision", "missing"); !errors.Is(err, ErrAgentInstructionsConflict) {
				t.Fatalf("stale legacy save: %v", err)
			}
			if _, migrated, err := SaveAgentInstructions(content, read.Revision); err != nil || !migrated {
				t.Fatalf("legacy migration not reported: %v %v", migrated, err)
			}
			if migrated, err := ReadAgentInstructions(); err != nil || migrated != read {
				t.Fatalf("migration changed bytes or revision: %+v %v", migrated, err)
			}
			if _, err = os.Stat(legacy); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("legacy file remains: %v", err)
			}
			after, err := os.Stat(AgentInstructionsPath())
			if err != nil || after.Mode().Perm() != before.Mode().Perm() {
				t.Fatalf("migration changed permissions: %v %v", after, err)
			}
			if _, _, err = SaveAgentInstructions("edited", read.Revision); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAgentInstructionsMigrationDuplicates(t *testing.T) {
	for _, same := range []bool{true, false} {
		t.Run(fmt.Sprint(same), func(t *testing.T) {
			agentInstructionsTestDir(t)
			legacy := "legacy"
			canonical := legacy
			if !same {
				canonical = "canonical"
			}
			writeAgentInstructionsFixture(t, LegacyAgentInstructionsPath(), legacy)
			writeAgentInstructionsFixture(t, AgentInstructionsPath(), canonical)
			read, err := ReadAgentInstructions()
			if same {
				if err != nil {
					t.Fatal(err)
				}
				if _, migrated, err := SaveAgentInstructions("edited", read.Revision); err != nil || !migrated {
					t.Fatalf("duplicate cleanup not reported: %v %v", migrated, err)
				}
				if _, err = os.Stat(LegacyAgentInstructionsPath()); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("duplicate not cleaned up: %v", err)
				}
				return
			}
			if !errors.Is(err, ErrAgentInstructionsLocationConflict) {
				t.Fatalf("different files not rejected: %v", err)
			}
			if _, _, err = SaveAgentInstructions("replacement", "missing"); !errors.Is(err, ErrAgentInstructionsLocationConflict) {
				t.Fatalf("conflicting save not rejected: %v", err)
			}
			for path, want := range map[string]string{LegacyAgentInstructionsPath(): legacy, AgentInstructionsPath(): canonical} {
				actual, err := os.ReadFile(path)
				if err != nil || string(actual) != want {
					t.Fatalf("conflict lost %s: %q %v", path, actual, err)
				}
			}
		})
	}
}

func TestAgentInstructionsMigrationFailurePreservesLegacy(t *testing.T) {
	agentInstructionsTestDir(t)
	writeAgentInstructionsFixture(t, LegacyAgentInstructionsPath(), "original")
	read, err := ReadAgentInstructions()
	if err != nil {
		t.Fatal(err)
	}
	// A non-directory destination must never cause deletion of the old source.
	if err = os.WriteFile(filepath.Join(DataDir, "storage"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = SaveAgentInstructions("replacement", read.Revision); err == nil {
		t.Fatal("accepted invalid storage directory")
	}
	actual, err := os.ReadFile(LegacyAgentInstructionsPath())
	if err != nil || string(actual) != "original" {
		t.Fatalf("failed migration lost original: %q %v", actual, err)
	}
}

func TestAgentInstructionsInvalidLegacyPreserved(t *testing.T) {
	for _, content := range []string{strings.Repeat("a", MaxAgentInstructionsSize+1), "\xff", "\x00"} {
		t.Run(fmt.Sprintf("bytes=%d", len(content)), func(t *testing.T) {
			agentInstructionsTestDir(t)
			writeAgentInstructionsFixture(t, LegacyAgentInstructionsPath(), content)
			if _, err := ReadAgentInstructions(); err == nil {
				t.Fatal("accepted invalid legacy source")
			}
			if _, _, err := SaveAgentInstructions("replacement", "missing"); err == nil {
				t.Fatal("overwrote invalid legacy source")
			}
			actual, err := os.ReadFile(LegacyAgentInstructionsPath())
			if err != nil || string(actual) != content {
				t.Fatalf("invalid legacy source lost: %v", err)
			}
		})
	}
}
