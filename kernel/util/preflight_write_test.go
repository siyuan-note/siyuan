package util

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/filelock"
)

func TestPreflightWritePreservesRejectedSource(t *testing.T) {
	for _, mapped := range []bool{false, true} {
		name := filepath.Join(t.TempDir(), "source.sy")
		refused := errors.New("unsupported source")
		if err := WriteFileWithPreflight(name, []byte("new"), mapped, func(current []byte) error {
			if current != nil {
				t.Fatal("missing source did not pass nil")
			}
			return refused
		}); !errors.Is(err, refused) {
			t.Fatal(err)
		}
		if _, err := os.Stat(name); !os.IsNotExist(err) {
			t.Fatal("rejected creation wrote a file")
		}
		original := bytes.Repeat([]byte("protected"), os.Getpagesize())
		if err := os.WriteFile(name, original, 0644); err != nil {
			t.Fatal(err)
		}
		before, _ := os.Stat(name)
		if err := WriteFileWithPreflight(name, []byte("short"), mapped, func(current []byte) error {
			if !bytes.Equal(current, original) {
				t.Fatal("preflight did not see original bytes")
			}
			return refused
		}); !errors.Is(err, refused) {
			t.Fatal("preflight rejection fell through to a fallback write", err)
		}
		after, err := os.Stat(name)
		if err != nil || !after.ModTime().Equal(before.ModTime()) || after.Size() != before.Size() {
			t.Fatal("rejected write changed source metadata", err)
		}
		retained, _ := os.ReadFile(name)
		if !bytes.Equal(retained, original) {
			t.Fatal("rejected write changed source bytes")
		}
		if err = WriteFileWithPreflight(name, []byte("accepted"), mapped, func([]byte) error { return nil }); err != nil {
			t.Fatal(err)
		}
		retained, _ = os.ReadFile(name)
		if string(retained) != "accepted" {
			t.Fatal("supported source was not replaced")
		}
	}
}

func TestPreflightWriteSerializesConcurrentMutation(t *testing.T) {
	name := filepath.Join(t.TempDir(), "source.sy")
	if err := os.WriteFile(name, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	entered, proceed := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- WriteFileWithPreflight(name, []byte("first"), true, func([]byte) error {
			close(entered)
			<-proceed
			return nil
		})
	}()
	<-entered
	second := make(chan error, 1)
	attempting := make(chan struct{})
	go func() {
		close(attempting)
		second <- filelock.WriteFile(name, []byte("second"))
	}()
	<-attempting
	select {
	case err := <-second:
		close(proceed)
		<-done
		t.Fatal("concurrent writer completed before source validation finished", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(proceed)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(name)
	if err != nil || string(actual) != "second" {
		t.Fatal("source changed between validation and commit", err)
	}
}
