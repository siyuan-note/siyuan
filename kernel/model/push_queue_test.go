// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestReadPushQueueLongRecord(t *testing.T) {
	want := []pushEntry{{Action: "rename", Title: "first"}, {Action: "rename", Title: strings.Repeat(" ", 128*1024) + "title"}, {Action: "rename", Title: "last"}}
	var queue strings.Builder
	for _, entry := range want {
		data, err := json.Marshal(entry)
		if err != nil {
			t.Fatal(err)
		}
		queue.Write(data)
		queue.WriteByte('\n')
	}
	for _, data := range []string{queue.String(), strings.TrimSuffix(queue.String(), "\n"), "\ninvalid JSON\n" + queue.String()} {
		got, err := readPushQueue(strings.NewReader(data))
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("queue records changed: %v, %v", got, err)
		}
	}
}

type failingPushQueueReader struct{ err error }

func (reader failingPushQueueReader) Read([]byte) (int, error) { return 0, reader.err }

func TestReadPushQueueRejectsPartialRead(t *testing.T) {
	want := errors.New("injected read failure")
	reader := io.MultiReader(strings.NewReader("{\"action\":\"reloadUI\"}\n"), failingPushQueueReader{want})
	if entries, err := readPushQueue(reader); !errors.Is(err, want) || len(entries) != 0 {
		t.Fatalf("partial queue must not be dispatched: %v, %v", entries, err)
	}
}

func TestLoadPushQueueReadFailure(t *testing.T) {
	previous := pushQueuePath
	pushQueuePath = filepath.Join(t.TempDir(), "queue-directory")
	t.Cleanup(func() { pushQueuePath = previous })
	if err := os.Mkdir(pushQueuePath, 0700); err != nil {
		t.Fatal(err)
	}
	if entries, err := loadPushQueue(); err == nil || len(entries) != 0 {
		t.Fatalf("unreadable queue must return an error: %v, %v", entries, err)
	}
}
