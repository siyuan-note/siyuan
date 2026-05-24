// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/lute"
	"github.com/88250/lute/render"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/logging"
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
	defer func() { _ = pushFlock.Unlock() }()

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

	entries := loadPushQueue()
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
		case "rename":
			util.BroadcastByType("filetree", "rename", 0, "", map[string]any{
				"box":   e.Box,
				"path":  e.Path,
				"title": e.Title,
			})
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
		case "reloadProtyle":
			bt := treenode.GetBlockTree(e.ID)
			if bt != nil {
				util.PushReloadProtyle(bt.RootID)
			}
		case "reloadAttrView":
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

func loadPushQueue() (entries []pushEntry) {
	f, err := os.Open(pushQueuePath)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("open push queue for reading failed: %s", err)
		}
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if 0 == len(line) {
			continue
		}
		var entry pushEntry
		if err = json.Unmarshal(line, &entry); err != nil {
			logging.LogWarnf("skip corrupted push queue line: %s", err)
			continue
		}
		entries = append(entries, entry)
	}
	if err = scanner.Err(); err != nil {
		logging.LogErrorf("scan push queue failed: %s", err)
	}
	return
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
