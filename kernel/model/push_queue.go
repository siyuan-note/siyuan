// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/render"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type pushEntry struct {
	Action string `json:"action"`
	Box    string `json:"box,omitempty"`
	Path   string `json:"path,omitempty"`
	ID     string `json:"id,omitempty"`
	Title  string `json:"title,omitempty"`
}

var (
	pushMu        sync.Mutex
	pushFlock     *flock.Flock
	pushQueuePath string
	pushNotifyCh  = make(chan struct{}, 1)
)

func ensurePushQueue() {
	if "" != pushQueuePath {
		return
	}
	pushQueuePath = filepath.Join(util.QueueDir, "push.queue")
	os.MkdirAll(util.QueueDir, 0755)
	pushFlock = flock.New(pushQueuePath + ".lock")
}

func AppendPushCreateEntry(box, p string) {
	appendPushEntry(pushEntry{Action: "create", Box: box, Path: p})
}

func AppendPushRemoveEntry(box, p, id string) {
	appendPushEntry(pushEntry{Action: "remove", Box: box, Path: p, ID: id})
}

func AppendPushRenameEntry(box, p, title string) {
	appendPushEntry(pushEntry{Action: "rename", Box: box, Path: p, Title: title})
}

func AppendPushReloadDocInfoEntry(box, p string) {
	appendPushEntry(pushEntry{Action: "reloadDocInfo", Box: box, Path: p})
}

func AppendPushReloadProtyleEntry(id string) {
	appendPushEntry(pushEntry{Action: "reloadProtyle", ID: id})
}

func AppendPushReloadAttrViewEntry(avID string) {
	appendPushEntry(pushEntry{Action: "reloadAttrView", ID: avID})
}

func AppendPushReloadUIEntry() {
	appendPushEntry(pushEntry{Action: "reloadUI"})
}

func AppendPushReloadFiletreeEntry() {
	appendPushEntry(pushEntry{Action: "reloadFiletree"})
}

func AppendPushReloadTagEntry() {
	appendPushEntry(pushEntry{Action: "reloadTag"})
}

func appendPushEntry(entry pushEntry) {
	ensurePushQueue()

	data, err := json.Marshal(entry)
	if err != nil {
		logging.LogErrorf("marshal push entry failed: %s", err)
		return
	}
	data = append(data, '\n')

	_ = pushFlock.Lock()
	defer func() {
		_ = pushFlock.Unlock()
		select {
		case pushNotifyCh <- struct{}{}:
		default:
		}
	}()

	pushMu.Lock()
	defer pushMu.Unlock()

	f, err := os.OpenFile(pushQueuePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		logging.LogErrorf("open push queue for append failed: %s", err)
		return
	}
	defer f.Close()

	if _, err = f.Write(data); err != nil {
		logging.LogErrorf("write push queue failed: %s", err)
	}
}

func PollPushQueue() {
	ensurePushQueue()

	_ = pushFlock.Lock()
	defer func() { _ = pushFlock.Unlock() }()

	entries, err := loadPushQueue()
	if err != nil {
		logging.LogErrorf("read push queue failed: %s", err)
		return
	}
	if 1 > len(entries) {
		return
	}

	logging.LogInfof("polling [%d] push queue operations", len(entries))

	for _, e := range entries {
		switch e.Action {
		case "create":
			box := Conf.Box(e.Box)
			if nil == box {
				logging.LogWarnf("push queue create: box [%s] not found", e.Box)
				continue
			}
			PushCreate(box, e.Path, nil)
		case "remove":
			evt := util.NewCmdResult("removeDoc", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{"ids": []string{e.ID}}
			util.PushEvent(evt)
			cache.RemoveTreeData(e.ID)
			cache.RemoveDocIAL(e.Path)
		case "rename":
			util.BroadcastByType("filetree", "rename", 0, "", map[string]any{
				"box":   e.Box,
				"path":  e.Path,
				"title": e.Title,
			})
			cache.RemoveDocIAL(e.Path)
		case "reloadDocInfo":
			luteEngine := lute.New()
			tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("push queue reloadDocInfo: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
			size := uint64(len(renderer.Render()))
			refreshDocInfo0(tree, size)
			cache.RemoveDocIAL(e.Path)
			cache.RemoveTreeData(tree.Root.ID)
		case "reloadProtyle":
			bt := treenode.GetBlockTree(e.ID)
			if bt != nil {
				cache.RemoveTreeData(bt.RootID)
				cache.RemoveBlockIAL(e.ID)
				util.PushReloadProtyle(bt.RootID)
			}
		case "reloadAttrView":
			cache.RemoveAVData(e.ID)
			util.BroadcastByType("protyle", "refreshAttributeView", 0, "", map[string]any{"id": e.ID})
		case "reloadUI":
			util.ReloadUI()
		case "reloadFiletree":
			util.BroadcastByType("filetree", "reloadFiletree", 0, "", nil)
		case "reloadTag":
			util.BroadcastByType("main", "reloadTag", 0, "", nil)
		}
	}

	clearPushQueue()
}

func StartPushQueueConsumer() {
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			PollPushQueue()
			select {
			case <-pushNotifyCh:
			case <-ticker.C:
			}
		}
	}()
}

func loadPushQueue() (entries []pushEntry, err error) {
	f, err := os.Open(pushQueuePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	return readPushQueue(f)
}

// Read the complete queue before dispatching anything. A failed read must never
// turn a partial prefix into permission to truncate unread notifications.
func readPushQueue(reader io.Reader) (entries []pushEntry, err error) {
	buffer := bufio.NewReader(reader)
	for {
		line, readErr := buffer.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			return nil, readErr
		}
		if 0 == len(line) {
			return entries, nil
		}
		var entry pushEntry
		if err = json.Unmarshal(line, &entry); err != nil {
			logging.LogWarnf("skip corrupted push queue line: %s", err)
			continue
		}
		entries = append(entries, entry)
		if readErr == io.EOF {
			return entries, nil
		}
	}
}

func clearPushQueue() {
	pushMu.Lock()
	defer pushMu.Unlock()

	if err := os.Truncate(pushQueuePath, 0); err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("clear push queue failed: %s", err)
		}
	}
}

func closePushQueue() {
	os.Remove(filepath.Join(util.QueueDir, "push.queue.lock"))
}
