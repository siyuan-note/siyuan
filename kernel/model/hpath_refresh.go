package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 恢复记录只含稳定标识及数据路径，不能写入加密笔记本的标题或正文。
// 游标不持久化：重启后从源文档恢复路径，已完成的行不会重复写入。
type hpathRefreshEntry struct {
	Box  string `json:"box"`
	ID   string `json:"id"`
	Path string `json:"path"`
}

type hpathRefreshTask struct {
	hpathRefreshEntry
	due         time.Time
	first       time.Time
	recover     bool
	docs        []string
	index       int
	blockAfter  int64
	treeAfter   int64
	fingerprint [32]byte
	scope       [32]byte
	limit       int
	covers      map[string]*hpathRefreshTask
	coveredBy   *hpathRefreshTask
	started     time.Time
	active      time.Duration
	batches     int
}

var hpathRefresh = struct {
	*sync.Mutex
	file      string
	tasks     map[string]*hpathRefreshTask
	last      string
	nextPrune time.Time
}{Mutex: &sql.HPathRefreshLock}

func init() {
	sql.ResetHPathRefreshQueue = resetHPathRefreshQueueLocked
}

func loadHPathRefreshLocked() error {
	p := filepath.Join(util.QueueDir, "hpath-refresh.queue")
	if hpathRefresh.file == p && hpathRefresh.tasks != nil {
		return nil
	}
	tasks, err := readHPathRefreshTasks(p)
	if err != nil {
		return err
	}
	hpathRefresh.file, hpathRefresh.tasks, hpathRefresh.last = p, tasks, ""
	hpathRefresh.nextPrune = time.Time{}
	return nil
}

func readHPathRefreshTasks(p string) (map[string]*hpathRefreshTask, error) {
	tasks := map[string]*hpathRefreshTask{}
	data, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return tasks, nil
	}
	if err != nil {
		return nil, err
	}
	var store struct {
		Version int                 `json:"version"`
		Tasks   []hpathRefreshEntry `json:"tasks"`
	}
	if err = json.Unmarshal(data, &store); err != nil {
		return nil, err
	}
	if store.Version != 1 {
		return nil, fmt.Errorf("unsupported hpath refresh version %d", store.Version)
	}
	for _, entry := range store.Tasks {
		if entry.ID == "" || entry.Box == "" {
			return nil, errors.New("invalid hpath refresh entry")
		}
		if _, err = filesys.ValidateBoxRelativePath(entry.Box, entry.Path); err != nil {
			return nil, err
		}
		tasks[entry.Box+"/"+entry.ID] = &hpathRefreshTask{hpathRefreshEntry: entry, recover: true, limit: 256}
	}
	return tasks, nil
}

func saveHPathRefreshLocked() error {
	return writeHPathRefreshTasks(hpathRefresh.file, hpathRefresh.tasks)
}

func writeHPathRefreshTasks(p string, tasks map[string]*hpathRefreshTask) error {
	if len(tasks) == 0 {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	entries := make([]hpathRefreshEntry, 0, len(tasks))
	for _, task := range tasks {
		entries = append(entries, task.hpathRefreshEntry)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Box+entries[i].ID < entries[j].Box+entries[j].ID
	})
	data, err := json.Marshal(struct {
		Version int                 `json:"version"`
		Tasks   []hpathRefreshEntry `json:"tasks"`
	}{1, entries})
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	// WriteFile 使用临时文件、Sync 和替换，写入成功后才允许修改源文档。
	return filelock.WriteFile(p, data)
}

func removeHPathRefreshTasksLocked(remove func(*hpathRefreshTask) bool) error {
	remaining := make(map[string]*hpathRefreshTask, len(hpathRefresh.tasks))
	for key, task := range hpathRefresh.tasks {
		if !remove(task) {
			remaining[key] = task
		}
	}
	if len(remaining) == len(hpathRefresh.tasks) {
		return nil
	}
	if err := writeHPathRefreshTasks(hpathRefresh.file, remaining); err != nil {
		return err
	}
	hpathRefresh.tasks = remaining
	for key, task := range remaining {
		if parent := task.coveredBy; parent != nil && (remaining[parent.Box+"/"+parent.ID] != parent || parent.covers[key] != task) {
			task.coveredBy = nil
		}
		for childKey, child := range task.covers {
			if remaining[childKey] != child {
				delete(task.covers, childKey)
			}
		}
	}
	return nil
}

func resetHPathRefreshQueueLocked() error {
	if err := loadHPathRefreshLocked(); err != nil {
		return err
	}
	// 普通数据库重建不涉及独立加密数据库，后者的恢复任务继续保留。
	return removeHPathRefreshTasksLocked(func(task *hpathRefreshTask) bool {
		if IsEncryptedBox(task.Box) {
			return false
		}
		// 清理写盘失败时仍从源文档重新恢复，避免沿用重建前的行号。
		task.docs, task.index, task.recover = nil, 0, true
		task.covers, task.coveredBy = nil, nil
		task.blockAfter, task.treeAfter = 0, 0
		return true
	})
}

func removeHPathRefreshBox(boxID string) {
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	if err := loadHPathRefreshLocked(); err != nil {
		logging.LogErrorf("load hpath tasks when removing notebook [%s] failed: %s", boxID, err)
		return
	}
	if err := removeHPathRefreshTasksLocked(func(task *hpathRefreshTask) bool { return task.Box == boxID }); err != nil {
		logging.LogErrorf("remove notebook hpath tasks [%s] failed: %s", boxID, err)
	}
}

func pruneHPathRefreshTasksLocked() error {
	if time.Now().Before(hpathRefresh.nextPrune) {
		return nil
	}
	hpathRefresh.nextPrune = time.Now().Add(time.Minute)
	missing := map[string]bool{}
	for _, task := range hpathRefresh.tasks {
		if _, checked := missing[task.Box]; !checked {
			_, err := os.Stat(filepath.Join(util.DataDir, task.Box))
			// 仅回收确认不存在的笔记本，关闭、锁定或读取失败均保留恢复记录。
			missing[task.Box] = os.IsNotExist(err)
		}
	}
	return removeHPathRefreshTasksLocked(func(task *hpathRefreshTask) bool { return missing[task.Box] })
}

func queueHPathRefreshLocked(tree *parse.Tree) (key string, err error) {
	if err = loadHPathRefreshLocked(); err != nil {
		return
	}
	key = tree.Box + "/" + tree.ID
	first := time.Now()
	if old := hpathRefresh.tasks[key]; old != nil {
		first = old.first
	}
	// 后代再次改名时重置覆盖它的父任务；每个源文档仍保留恢复记录，避免合并后漏掉中断的写入。
	for otherKey, other := range hpathRefresh.tasks {
		if other.Box != tree.Box || otherKey == key {
			continue
		}
		bt := treenode.GetBlockTreeInBox(other.ID, other.Box)
		if bt == nil || bt.BoxID != tree.Box {
			continue
		}
		if strings.HasPrefix(tree.Path, strings.TrimSuffix(bt.Path, ".sy")+"/") {
			other.docs, other.index = nil, 0
			other.covers = nil
			other.blockAfter, other.treeAfter = 0, 0
			other.due = time.Now().Add(500 * time.Millisecond)
		}
	}
	previous := hpathRefresh.tasks[key]
	hpathRefresh.tasks[key] = &hpathRefreshTask{
		hpathRefreshEntry: hpathRefreshEntry{tree.Box, tree.ID, tree.Path},
		first:             first, due: time.Now().Add(500 * time.Millisecond), recover: true, limit: 256,
	}
	if err = saveHPathRefreshLocked(); err != nil {
		if previous == nil {
			delete(hpathRefresh.tasks, key)
		} else {
			hpathRefresh.tasks[key] = previous
		}
	}
	return
}

func writeRenameDoc(tree *parse.Tree) (size uint64, err error) {
	if err = AcquireEncryptedBoxOperation(tree.Box); err != nil {
		return
	}
	defer ReleaseEncryptedBoxOperation(tree.Box)
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	if util.IsExiting.Load() {
		return 0, errors.New("kernel is exiting")
	}
	tree.HPath = treenode.CurrentParentHPath(tree)
	key, err := queueHPathRefreshLocked(tree)
	if err != nil {
		return 0, err
	}
	if size, err = filesys.WriteTree(tree); err != nil {
		return
	}
	if treenode.GetBlockTreeInBox(tree.ID, tree.Box) == nil {
		treenode.UpsertBlockTree(tree)
	}
	if err = treenode.RefreshDocHPaths(tree); err != nil {
		return
	}
	sql.RenameDocQueue(tree)
	hpathRefresh.tasks[key].recover = false
	return
}

// RefreshHPathsJob 每次最多处理一个批次，普通编辑和索引刷新优先。
func RefreshHPathsJob() {
	if !util.IsBooted() || util.IsExiting.Load() || txQueueSize() > 0 || isFlushing.Load() || !syncLock.TryLock() {
		return
	}
	defer syncLock.Unlock()
	if !databaseIndexDataLock.TryLock() {
		return
	}
	defer databaseIndexDataLock.Unlock()
	if !hpathRefresh.TryLock() {
		return
	}
	defer hpathRefresh.Unlock()
	if err := loadHPathRefreshLocked(); err != nil {
		logging.LogErrorf("load hpath refresh tasks failed: %s", err)
		return
	}
	var keys []string
	if len(hpathRefresh.tasks) == 0 {
		return
	}
	if err := pruneHPathRefreshTasksLocked(); err != nil {
		logging.LogWarnf("prune hpath refresh tasks failed: %s", err)
	}
	opened := map[string]bool{}
	for _, box := range Conf.GetOpenedBoxes() {
		opened[box.ID] = true
	}
	for key, task := range hpathRefresh.tasks {
		if !opened[task.Box] {
			continue
		}
		if parent := task.coveredBy; parent != nil {
			if hpathRefresh.tasks[parent.Box+"/"+parent.ID] == parent && parent.covers[key] == task {
				continue
			}
			task.coveredBy = nil
		}
		if time.Now().Before(task.due) && time.Since(task.first) < 2*time.Second {
			continue
		}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return
	}
	sort.Strings(keys)
	key := keys[0]
	for _, candidate := range keys {
		if candidate > hpathRefresh.last {
			key = candidate
			break
		}
	}
	// 先恢复所有源文档的元数据，再让父任务合并后代的批量路径更新。
	for _, candidate := range keys {
		if hpathRefresh.tasks[candidate].recover {
			key = candidate
			break
		}
	}
	hpathRefresh.last = key
	task := hpathRefresh.tasks[key]
	if err := AcquireEncryptedBoxOperation(task.Box); err != nil {
		return
	}
	defer ReleaseEncryptedBoxOperation(task.Box)
	start := time.Now()
	done, err := false, error(nil)
	for {
		index, blockAfter, treeAfter, recovering, docCount := task.index, task.blockAfter, task.treeAfter, task.recover, len(task.docs)
		done, err = refreshHPathsTask(task)
		if done || err != nil || time.Since(start) >= 20*time.Millisecond || txQueueSize() > 0 {
			break
		}
		if index == task.index && blockAfter == task.blockAfter && treeAfter == task.treeAfter && recovering == task.recover && docCount == len(task.docs) {
			break
		}
	}
	if err != nil {
		// 失败保留源文件和恢复记录；重试重新读取当前位置及标题。
		task.docs, task.index, task.recover = nil, 0, true
		task.covers = nil
		task.blockAfter, task.treeAfter = 0, 0
		task.first, task.due = time.Now().Add(5*time.Second), time.Now().Add(5*time.Second)
		logging.LogWarnf("refresh document hpaths [%s] failed: %s", key, err)
		return
	}
	if done {
		removed := map[string]*hpathRefreshTask{key: task}
		root := treenode.GetBlockTreeInBox(task.ID, task.Box)
		for coveredKey, covered := range task.covers {
			if hpathRefresh.tasks[coveredKey] != covered || root == nil {
				continue
			}
			doc := treenode.GetBlockTreeInBox(covered.ID, root.BoxID)
			if doc != nil && doc.BoxID == root.BoxID && strings.HasPrefix(doc.Path, strings.TrimSuffix(root.Path, ".sy")+"/") {
				removed[coveredKey] = covered
				delete(hpathRefresh.tasks, coveredKey)
			}
		}
		delete(hpathRefresh.tasks, key)
		if err = saveHPathRefreshLocked(); err != nil {
			for removedKey, removedTask := range removed {
				hpathRefresh.tasks[removedKey] = removedTask
			}
			logging.LogErrorf("save hpath refresh tasks failed: %s", err)
			return
		}
		sql.ClearCache()
		util.BroadcastByType("main", "databaseIndexCommit", 0, "", map[string]any{"rootIDs": []string{task.ID}, "backlinkChanged": true, "backlinkFull": true})
		if !task.started.IsZero() && time.Since(task.started) > time.Second {
			logging.LogInfof("refreshed document hpaths [%s], docs [%d], batches [%d], elapsed [%dms], active [%dms]", key, len(task.docs), task.batches, time.Since(task.started).Milliseconds(), task.active.Milliseconds())
		}
	}
}

func refreshHPathsTask(task *hpathRefreshTask) (done bool, err error) {
	if task.started.IsZero() {
		task.started = time.Now()
	}
	root := treenode.GetBlockTreeInBox(task.ID, task.Box)
	if !IsEncryptedBox(task.Box) && (root == nil || root.BoxID != task.Box) {
		root = treenode.GetBlockTree(task.ID)
		if root != nil && IsEncryptedBox(root.BoxID) {
			return false, errors.New("hpath refresh crossed an encrypted notebook boundary")
		}
	}
	if root == nil {
		// 索引尚未恢复时不能丢弃磁盘上仍存在的文档任务。
		if _, statErr := os.Stat(filepath.Join(util.DataDir, task.Box, task.Path)); statErr == nil {
			return false, errors.New("hpath refresh document is not indexed")
		} else if !os.IsNotExist(statErr) {
			return false, statErr
		}
		return true, nil
	}
	scope := sha256.Sum256([]byte(root.BoxID + "\x00" + root.Path + "\x00" + root.HPath))
	if task.scope != scope {
		task.docs, task.index, task.covers = nil, 0, nil
		task.blockAfter, task.treeAfter = 0, 0
		task.scope = scope
	}
	if task.docs == nil {
		if task.recover {
			hpath, properties, loadErr := filesys.ReadDocHPath(root.BoxID, root.Path)
			if loadErr != nil {
				return false, loadErr
			}
			tree := treenode.NewTree(root.BoxID, root.Path, hpath, properties["title"])
			tree.Root.KramdownIAL = nil
			for key, value := range properties {
				tree.Root.SetIALAttr(key, value)
			}
			if err = treenode.RefreshDocHPaths(tree); err != nil {
				return false, err
			}
			sql.RenameDocQueue(tree)
			task.recover = false
			return false, nil
		}
		for _, other := range hpathRefresh.tasks {
			if other.recover && other.Box == root.BoxID {
				bt := treenode.GetBlockTreeInBox(other.ID, other.Box)
				if bt != nil && (strings.HasPrefix(bt.Path, strings.TrimSuffix(root.Path, ".sy")+"/") || strings.HasPrefix(root.Path, strings.TrimSuffix(bt.Path, ".sy")+"/")) {
					return false, nil
				}
			}
		}
		docs, listErr := treenode.DocHPaths(root.BoxID, root.Path)
		if listErr != nil {
			return false, listErr
		}
		task.docs = make([]string, 0, len(docs))
		for _, doc := range docs {
			task.docs = append(task.docs, doc.ID)
		}
		task.covers = map[string]*hpathRefreshTask{}
		for key, other := range hpathRefresh.tasks {
			if other == task || other.Box != root.BoxID {
				continue
			}
			bt := treenode.GetBlockTreeInBox(other.ID, other.Box)
			if bt != nil && bt.BoxID == root.BoxID && strings.HasPrefix(bt.Path, strings.TrimSuffix(root.Path, ".sy")+"/") {
				task.covers[key] = other
				other.coveredBy = task
			}
		}
	}
	if task.index >= len(task.docs) {
		current := treenode.GetBlockTreeInBox(root.ID, root.BoxID)
		if current == nil || current.BoxID != root.BoxID || current.Path != root.Path || current.HPath != root.HPath {
			return false, errors.New("document changed before hpath refresh completed")
		}
		return true, nil
	}
	doc := treenode.GetBlockTreeInBox(task.docs[task.index], root.BoxID)
	if doc == nil || doc.BoxID != root.BoxID || (doc.Path != root.Path && !strings.HasPrefix(doc.Path, strings.TrimSuffix(root.Path, ".sy")+"/")) {
		task.index++
		task.blockAfter, task.treeAfter = 0, 0
		return false, nil
	}
	fingerprint := sha256.Sum256([]byte(doc.BoxID + "\x00" + doc.Path + "\x00" + doc.HPath))
	if task.fingerprint != fingerprint {
		task.blockAfter, task.treeAfter = 0, 0
		task.fingerprint = fingerprint
	}
	start := time.Now()
	blockAfter, treeAfter, docDone, busy, err := sql.RefreshHPathsBatch(doc, task.blockAfter, task.treeAfter, task.limit)
	if err != nil || busy {
		return false, err
	}
	task.batches++
	task.active += time.Since(start)
	task.blockAfter, task.treeAfter = blockAfter, treeAfter
	if time.Since(start) > 25*time.Millisecond && task.limit > 32 {
		task.limit /= 2
	} else if time.Since(start) < 10*time.Millisecond && task.limit < 512 {
		task.limit *= 2
	}
	if docDone {
		task.index++
		task.blockAfter, task.treeAfter = 0, 0
	}
	return false, nil
}

// recoverDocHPaths 在启动时先恢复文档定位元数据，内容块副本继续由后台补齐。
func recoverDocHPaths() {
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	if err := loadHPathRefreshLocked(); err != nil {
		logging.LogErrorf("load document path recovery failed: %s", err)
		return
	}
	for _, task := range hpathRefresh.tasks {
		if !task.recover || Conf.Box(task.Box) == nil {
			continue
		}
		if err := AcquireEncryptedBoxOperation(task.Box); err != nil {
			continue
		}
		_, err := refreshHPathsTask(task)
		ReleaseEncryptedBoxOperation(task.Box)
		if err != nil {
			logging.LogErrorf("recover document paths [%s/%s] failed: %s", task.Box, task.ID, err)
		}
	}
}
