package util

import (
	"errors"
	"os"
	"path/filepath"
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
	content := "\ufeffUse citations.\r\n保留原文\r\n"
	saved, err := SaveAgentInstructions(content, missing.Revision)
	if err != nil {
		t.Fatal(err)
	}
	read, err := ReadAgentInstructions()
	if err != nil || read != saved || read.Content != content {
		t.Fatalf("round trip: %+v %v", read, err)
	}
	for _, revision := range []string{"", "missing", "stale"} {
		if _, err = SaveAgentInstructions("lost update", revision); !errors.Is(err, ErrAgentInstructionsConflict) {
			t.Fatalf("accepted revision %q: %v", revision, err)
		}
	}
	empty, err := SaveAgentInstructions("", saved.Revision)
	if err != nil || empty.Revision == missing.Revision {
		t.Fatalf("empty file: %+v %v", empty, err)
	}
	if read, err = ReadAgentInstructions(); err != nil || read != empty {
		t.Fatalf("empty round trip: %+v %v", read, err)
	}
	if _, err = SaveAgentInstructions(strings.Repeat("a", MaxAgentInstructionsSize), empty.Revision); err != nil {
		t.Fatal(err)
	}
	maxContent, err := ReadAgentInstructions()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = SaveAgentInstructions(strings.Repeat("界", 11000), maxContent.Revision); !errors.Is(err, ErrAgentInstructionsTooLarge) {
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
		if _, err := SaveAgentInstructions("replacement", "missing"); err == nil {
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
	initial, err := SaveAgentInstructions("initial", "missing")
	if err != nil {
		t.Fatal(err)
	}
	errorsCh := make(chan error, 2)
	var wait sync.WaitGroup
	for _, value := range []string{"first", "second"} {
		wait.Go(func() { _, err := SaveAgentInstructions(value, initial.Revision); errorsCh <- err })
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
	agentInstructionsTestDir(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Dir(AgentInstructionsPath())); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := ReadAgentInstructions(); err == nil {
		t.Fatal("followed storage link")
	}
	if _, err := SaveAgentInstructions("escape", "missing"); err == nil {
		t.Fatal("wrote through storage link")
	}
}
