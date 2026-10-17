package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// UnusedEncryptedBoxAssets 只扫描目标加密笔记本，明文解析结果不写入全局缓存。
func UnusedEncryptedBoxAssets(ctx context.Context, boxID string) (items []*UnusedItem, err error) {
	err = withEncryptedAssetCleanup(ctx, boxID, func(dek []byte) error {
		items, err = scanEncryptedBoxUnusedAssets(ctx, boxID, dek)
		return err
	})
	return
}

// RemoveUnusedEncryptedBoxAssets 重新扫描用户确认的候选，完整备份后删除，失败时恢复全部原文件。
func RemoveUnusedEncryptedBoxAssets(ctx context.Context, boxID string, paths []string) (removed []string, err error) {
	removed = []string{}
	err = withEncryptedAssetCleanup(ctx, boxID, func(dek []byte) error {
		inventory, inventoryErr := encryptedCleanupSourceDigest(ctx, boxID)
		if inventoryErr != nil {
			return inventoryErr
		}
		items, scanErr := scanEncryptedBoxUnusedAssets(ctx, boxID, dek)
		if scanErr != nil {
			return scanErr
		}
		candidates := map[string]*UnusedItem{}
		for _, item := range items {
			candidates[item.Item] = item
		}
		selected := []*UnusedItem{}
		seen := map[string]bool{}
		for _, p := range paths {
			item := candidates[p]
			if item == nil {
				return fmt.Errorf("asset is not unused in notebook [%s]: %s", boxID, p)
			}
			if !seen[p] {
				selected = append(selected, item)
				seen[p] = true
			}
		}
		if len(selected) == 0 {
			return nil
		}
		verify := func() error {
			current, readErr := encryptedCleanupSourceDigest(ctx, boxID)
			if readErr != nil {
				return readErr
			}
			if current != inventory || txQueueSize() != 0 {
				return errors.New("asset references changed during cleanup; retry the request")
			}
			return nil
		}
		if err := deleteEncryptedBoxAssets(ctx, boxID, dek, selected, os.Remove, verify); err != nil {
			return err
		}
		for _, item := range selected {
			removed = append(removed, item.Item)
		}
		IncSync()
		return nil
	})
	return
}

// encryptedCleanupSourceDigest 校验完整引用源集合，包含扫描过程中新增或修改的智能体会话。
func encryptedCleanupSourceDigest(ctx context.Context, boxID string) (string, error) {
	hash := sha256.New()
	boxRoot := filepath.Join(util.DataDir, boxID)
	roots := []string{boxRoot, filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions")}
	for _, root := range roots {
		err := walkEncryptedCleanupFiles(ctx, root, root != boxRoot, func(p string, entry fs.DirEntry) error {
			rel, _ := filepath.Rel(root, p)
			if root == boxRoot && entry.IsDir() && (entry.Name() == "assets" || strings.HasPrefix(entry.Name(), ".")) {
				return filepath.SkipDir
			}
			if entry.IsDir() {
				fmt.Fprintln(hash, root, rel)
				return nil
			}
			if root == boxRoot && !strings.HasSuffix(entry.Name(), ".sy") &&
				!(strings.HasPrefix(filepath.ToSlash(rel), "storage/av/") && strings.HasSuffix(entry.Name(), ".json")) {
				return nil
			}
			if root != boxRoot && entry.Name() != "session.json" && entry.Name() != "runtime.json" {
				return nil
			}
			data, readErr := os.ReadFile(p)
			if readErr != nil {
				return readErr
			}
			fmt.Fprintln(hash, rel, sha256.Sum256(data))
			return nil
		})
		if err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// withEncryptedAssetCleanup 排空已提交编辑，并串行化同步、事务和目标笔记本的持久化读写。
// 先取得密钥副本，再持笔记本写锁；锁内只解析磁盘快照，不重入读锁或发布明文缓存。
func withEncryptedAssetCleanup(ctx context.Context, boxID string, operation func([]byte) error) (err error) {
	if !ast.IsNodeIDPattern(boxID) || !IsEncryptedBox(boxID) {
		return errors.New("an encrypted notebook ID is required")
	}
	release, err := AcquireEncryptedBoxOperations(ctx, []string{boxID})
	if err != nil {
		return errors.New(Conf.Language(314))
	}
	defer release()
	if err := lockAssetRelink(ctx, &syncLock); err != nil {
		return err
	}
	defer syncLock.Unlock()
	FlushTxQueue()
	if err := lockAssetRelink(ctx, &flushLock); err != nil {
		return err
	}
	defer flushLock.Unlock()
	if txQueueSize() != 0 {
		return errors.New(Conf.Language(239))
	}
	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		return errors.New(Conf.Language(314))
	}
	defer zeroAndClear(dek)
	releaseAdmission, err := admitEncryptedAssetCleanup(boxID)
	if err != nil {
		return err
	}
	defer releaseAdmission()
	if !tryAcquireBoxWriteLock(boxID) {
		return errors.New(Conf.Language(239))
	}
	defer func() {
		releaseBoxWriteLock(boxID)
		if errors.Is(err, errEncryptedAssetCleanupRecovery) {
			setEncryptedBoxState(boxID, EncryptedBoxStateError)
		}
	}()
	if err = recoverEncryptedAssetCleanup(boxID); err != nil {
		return err
	}
	return operation(dek)
}

// admitEncryptedAssetCleanup 仅允许当前响应的单个租约进入清理，拒绝尚未持读锁的在途操作。
func admitEncryptedAssetCleanup(boxID string) (func(), error) {
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	defer lifecycle.lock.Unlock()
	if lifecycle.assetCleanup || lifecycle.activeOperations != 1 {
		return nil, errors.New(Conf.Language(239))
	}
	lifecycle.assetCleanup = true
	return func() {
		lifecycle.lock.Lock()
		lifecycle.assetCleanup = false
		lifecycle.condition.Broadcast()
		lifecycle.lock.Unlock()
	}, nil
}

func walkEncryptedCleanupFiles(ctx context.Context, root string, optional bool, visit func(string, fs.DirEntry) error) error {
	return filepath.WalkDir(root, func(p string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			if optional && p == root && errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic links are not supported during encrypted asset cleanup: %s", p)
		}
		if p == root && !entry.IsDir() {
			return fmt.Errorf("asset reference scan root must be a directory: %s", p)
		}
		return visit(p, entry)
	})
}

func scanEncryptedBoxUnusedAssets(ctx context.Context, boxID string, dek []byte) (ret []*UnusedItem, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			ret, err = nil, fmt.Errorf("scan encrypted asset references failed: %v", recovered)
		}
	}()
	root := filepath.Join(util.DataDir, boxID)
	for _, p := range []string{root, filepath.Join(root, "assets"), filepath.Join(root, "storage", "av")} {
		if err = validateEncryptedCleanupPath(util.DataDir, p); err != nil {
			return nil, err
		}
	}
	assets := map[string]string{}
	assetRoot := filepath.Join(root, "assets")
	deferred, err := DeferredSyncAssets()
	if err != nil {
		return nil, err
	}
	for _, file := range deferred {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		if !strings.HasPrefix(file.Path, "/"+boxID+"/assets/") {
			continue
		}
		absPath := filepath.Join(util.DataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/")))
		key, keyErr := assetPathMapKey(assetRoot, absPath, false)
		if keyErr != nil {
			return nil, keyErr
		}
		skip := false
		for p := absPath; p != assetRoot; p = filepath.Dir(p) {
			if isSkipFile(filepath.Base(p)) || filelock.IsHidden(p) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		assets[key] = absPath
		for dir, absDir := path.Dir(key), filepath.Dir(absPath); dir != "assets"; dir, absDir = path.Dir(dir), filepath.Dir(absDir) {
			assets[dir+"/"] = absDir
		}
	}
	err = walkEncryptedCleanupFiles(ctx, assetRoot, true, func(p string, entry fs.DirEntry) error {
		if entry.IsDir() {
			if p == assetRoot {
				return nil
			}
			if isSkipFile(entry.Name()) || filelock.IsHidden(p) {
				return filepath.SkipDir
			}
			key, keyErr := assetPathMapKey(assetRoot, p, true)
			if keyErr == nil {
				assets[key] = p
			}
			return keyErr
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("asset must be a regular file: %s", p)
		}
		if isSkipFile(entry.Name()) || filelock.IsHidden(p) {
			return nil
		}
		key, keyErr := assetPathMapKey(assetRoot, p, false)
		if keyErr == nil {
			assets[key] = p
		}
		return keyErr
	})
	if err != nil {
		return nil, err
	}
	luteEngine := util.NewLute()
	dests := map[string]bool{}
	collect := func(dest string) {
		if parsed, parseErr := url.Parse(dest); parseErr == nil {
			if box := parsed.Query().Get("box"); box != "" && box != boxID {
				return
			}
		}
		if normalized := normalizeAssetScanLinkDest(dest); normalized != "" {
			dests[normalized] = true
		}
	}
	err = walkEncryptedCleanupFiles(ctx, root, false, func(p string, entry fs.DirEntry) error {
		if entry.IsDir() {
			if p != root && (isSkipFile(entry.Name()) || entry.Name() == "assets" || entry.Name() == "storage") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".sy") {
			return nil
		}
		data, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		relative, _ := filepath.Rel(root, p)
		plain, decryptErr := DecryptFile(boxID, filepath.ToSlash(relative), dek, data)
		if decryptErr != nil {
			return decryptErr
		}
		defer clear(plain)
		if specErr := treenode.CheckSpecJSON(plain); specErr != nil {
			return specErr
		}
		tree, _, parseErr := dataparser.ParseJSON(plain, luteEngine.ParseOptions)
		if parseErr != nil {
			return parseErr
		}
		if tree == nil || tree.Root == nil || tree.Root.ID+".sy" != entry.Name() {
			return fmt.Errorf("document ID does not match its basename: %s", p)
		}
		if specErr := treenode.CheckSpec(tree); specErr != nil {
			return specErr
		}
		if projectionErr := treenode.RefreshTableCellRichProjection(tree.Root); projectionErr != nil {
			return projectionErr
		}
		for _, dest := range getAssetsLinkDestsWithOptions(tree.Root, false, nil, assetLinkScanOptions{expandAssetLists: true}, normalizeAssetScanLinkDest) {
			collect(dest)
		}
		collect(treenode.GetDocTitleImgPath(tree.Root))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read notebook asset references failed: %w", err)
	}
	err = walkEncryptedCleanupFiles(ctx, filepath.Join(root, "storage", "av"), true, func(p string, entry fs.DirEntry) error {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			return nil
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !ast.IsNodeIDPattern(id) {
			return nil
		}
		data, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		plain, decryptErr := av.DecryptAVDataWithDEK(boxID, id, dek, data)
		if decryptErr != nil {
			return decryptErr
		}
		defer clear(plain)
		view, parseErr := av.ParseAttributeViewData(id, plain)
		if parseErr != nil {
			return parseErr
		}
		if view.ID != id {
			return fmt.Errorf("database ID does not match its basename: %s", p)
		}
		return collectEncryptedCleanupJSON(plain, luteEngine, collect)
	})
	if err != nil {
		return nil, fmt.Errorf("read notebook database references failed: %w", err)
	}
	// 会话正文、工具附件及在途轮次都可能保留资源引用；不加载其他笔记本或执行工具。
	err = walkEncryptedCleanupFiles(ctx, filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions"), true,
		func(p string, entry fs.DirEntry) error {
			if entry.IsDir() || (entry.Name() != "session.json" && entry.Name() != "runtime.json") {
				return nil
			}
			filelock.Lock(p)
			data, readErr := os.ReadFile(p)
			filelock.Unlock(p)
			if readErr != nil {
				return readErr
			}
			return collectEncryptedCleanupJSON(data, luteEngine, collect)
		})
	if err != nil {
		return nil, fmt.Errorf("read agent asset references failed: %w", err)
	}
	// PDF 正文可以尚未下载或暂时缺失，标注保护只依据持久化引用。
	var companions []string
	for dest := range dests {
		if index := strings.IndexAny(dest, "?#"); index >= 0 {
			dest = dest[:index]
		}
		decoded, _ := url.PathUnescape(dest)
		if strings.HasSuffix(strings.ToLower(dest), ".pdf") || strings.HasSuffix(strings.ToLower(decoded), ".pdf") {
			companions = append(companions, dest+".sya")
		}
	}
	for _, dest := range companions {
		dests[dest] = true
	}
	for _, dest := range removeReferencedAssetPaths(assets, dests) {
		delete(assets, dest)
	}
	ret = []*UnusedItem{}
	for p, absPath := range assets {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		if strings.HasSuffix(p, "/") {
			continue
		}
		if err = validateEncryptedCleanupPath(util.DataDir, absPath); err != nil {
			return nil, err
		}
		if err = EnsureAssetLocal(absPath); err != nil {
			return nil, err
		}
		file, openErr := os.Open(absPath)
		if openErr != nil {
			return nil, openErr
		}
		name, nameErr := DecryptAssetNameFromReader(boxID, path.Base(p), dek, file)
		file.Close()
		if nameErr != nil {
			return nil, nameErr
		}
		ret = append(ret, &UnusedItem{Item: p, Name: name, Path: p + "?box=" + boxID, AbsPath: absPath})
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].Item < ret[j].Item })
	return ret, nil
}

// collectEncryptedCleanupJSON 保守收集全部持久化字符串中的资源链接，包含数据库模板、富文本与工具附件。
func collectEncryptedCleanupJSON(data []byte, luteEngine *lute.Lute, collect func(string)) error {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var visit func(any)
	visit = func(v any) {
		switch typed := v.(type) {
		case string:
			if !strings.Contains(typed, "assets/") {
				return
			}
			collect(typed)
			tree := parse.Parse("", []byte(typed), luteEngine.ParseOptions)
			for _, dest := range getAssetsLinkDestsWithOptions(tree.Root, false, nil, assetLinkScanOptions{expandAssetLists: true}) {
				collect(dest)
			}
		case []any:
			for _, child := range typed {
				visit(child)
			}
		case map[string]any:
			for _, child := range typed {
				visit(child)
			}
		}
	}
	visit(value)
	return nil
}

type encryptedAssetCleanupFile struct {
	Path string `json:"path"`
	Hash string `json:"hash"`
}

type encryptedAssetCleanupJournal struct {
	Spec      int                         `json:"spec"`
	Committed bool                        `json:"committed"`
	Files     []encryptedAssetCleanupFile `json:"files"`
	Checksum  string                      `json:"checksum"`
}

func encryptedCleanupJournalChecksum(journal *encryptedAssetCleanupJournal) string {
	copy := *journal
	copy.Checksum = ""
	data, _ := json.Marshal(&copy)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

var errEncryptedAssetCleanupRecovery = errors.New("encrypted asset cleanup recovery is required")

func encryptedAssetCleanupDir(boxID string) string {
	return filepath.Join(util.WorkspaceDir, ".siyuan", "asset-cleanup", boxID)
}

func deleteEncryptedBoxAssets(ctx context.Context, boxID string, dek []byte, items []*UnusedItem, remove func(string) error, verify func() error) (err error) {
	journalDir := encryptedAssetCleanupDir(boxID)
	if err = os.MkdirAll(filepath.Dir(journalDir), 0700); err != nil {
		return
	}
	if err = os.Mkdir(journalDir, 0700); err != nil {
		return
	}
	journal := &encryptedAssetCleanupJournal{Spec: 1}
	deleting := false
	defer func() {
		if err != nil && deleting {
			if rollbackErr := recoverEncryptedAssetCleanup(boxID, journal); rollbackErr != nil {
				// 恢复失败后拒绝后续解密访问，保留清理日志，启动恢复完成前不进入同步。
				err = errors.Join(err, errEncryptedAssetCleanupRecovery, fmt.Errorf("restore encrypted assets failed: %w", rollbackErr))
			}
		} else if !deleting || err == nil {
			// 已提交标记保证清理日志删除失败不会撤销成功的操作。
			if cleanupErr := os.RemoveAll(journalDir); cleanupErr != nil && err == nil {
				// 下次启动或清理时继续回收已提交日志。
				return
			}
		}
	}()
	for _, item := range items {
		if err = ctx.Err(); err != nil {
			return
		}
		if err = EnsureAssetPrefixLocal(item.AbsPath); err != nil {
			return
		}
		file, openErr := os.Open(item.AbsPath)
		if openErr != nil {
			return openErr
		}
		_, err = DecryptAssetToWriter(boxID, path.Base(item.Item), dek, file, io.Discard)
		file.Close()
		if err != nil {
			return
		}
		backup := filepath.Join(journalDir, filepath.FromSlash(item.Item))
		if err = copyEncryptedCleanupFile(item.AbsPath, backup); err != nil {
			return
		}
		if err = syncEncryptedCleanupFile(backup); err != nil {
			return
		}
		hash, hashErr := encryptedCleanupFileHash(backup)
		if hashErr != nil {
			return hashErr
		}
		journal.Files = append(journal.Files, encryptedAssetCleanupFile{Path: item.Item, Hash: hash})
	}
	writeJournal := func() error {
		journal.Checksum = encryptedCleanupJournalChecksum(journal)
		data, marshalErr := json.Marshal(journal)
		if marshalErr != nil {
			return marshalErr
		}
		manifest := filepath.Join(journalDir, "manifest.json")
		return writeEncryptedCleanupData(manifest, data)
	}
	if err = writeJournal(); err != nil {
		return
	}
	if verify != nil {
		if err = verify(); err != nil {
			return
		}
	}
	var historyDir string
	if err = os.MkdirAll(util.HistoryDir, 0700); err != nil {
		return
	}
	for offset := 0; offset < 100; offset++ {
		historyDir = filepath.Join(util.HistoryDir, time.Now().Add(time.Duration(offset)*time.Second).Format("2006-01-02-150405")+"-clean")
		err = os.Mkdir(historyDir, 0700)
		if !errors.Is(err, os.ErrExist) {
			break
		}
	}
	if err != nil {
		return
	}
	for _, file := range journal.Files {
		historyPath := filepath.Join(historyDir, boxID, filepath.FromSlash(file.Path))
		if err = copyEncryptedCleanupFile(filepath.Join(journalDir, filepath.FromSlash(file.Path)), historyPath); err != nil {
			return
		}
		if err = syncEncryptedCleanupFile(historyPath); err != nil {
			return
		}
	}
	deleting = true
	for _, item := range items {
		if err = ctx.Err(); err != nil {
			return
		}
		if err = remove(item.AbsPath); err != nil {
			return
		}
	}
	if verify != nil {
		if err = verify(); err != nil {
			return
		}
	}
	journal.Committed = true
	if err = writeJournal(); err != nil {
		return
	}
	for _, item := range items {
		removeAssetThumbnail(item.AbsPath)
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return nil
}

func encryptedCleanupFileHash(p string) (string, error) {
	file, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func syncEncryptedCleanupFile(p string) error {
	file, err := os.OpenFile(p, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}

// writeEncryptedCleanupData 原子写入并刷盘已验证的数据，写入失败返回调用方进行补偿，不退出内核。
func writeEncryptedCleanupData(p string, data []byte) (err error) {
	file, err := os.CreateTemp(filepath.Dir(p), ".asset-cleanup-*.tmp")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer func() {
		file.Close()
		os.Remove(tmp)
	}()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// recoverEncryptedAssetCleanup 在挂载和同步前原样恢复未提交批次；解锁时继续认证恢复的密文。
func recoverEncryptedAssetCleanup(boxID string, rollback ...*encryptedAssetCleanupJournal) error {
	root := encryptedAssetCleanupDir(boxID)
	if err := validateEncryptedCleanupPath(util.WorkspaceDir, filepath.Join(root, "manifest.json")); err != nil {
		return err
	}
	journal := &encryptedAssetCleanupJournal{}
	var err error
	if len(rollback) > 0 {
		// 当前批次保留内存清单，提交标记写入或刷盘失败时也能恢复源文件。
		journal = rollback[0]
		journal.Committed = false
	} else {
		data, readErr := os.ReadFile(filepath.Join(root, "manifest.json"))
		if errors.Is(readErr, os.ErrNotExist) {
			// 清单落盘前不会删除源文件，留下的预备副本可直接回收。
			return os.RemoveAll(root)
		}
		if readErr != nil {
			return readErr
		}
		if err = json.Unmarshal(data, journal); err != nil {
			return err
		}
		if journal.Checksum != encryptedCleanupJournalChecksum(journal) {
			return errors.New("invalid encrypted asset cleanup journal checksum")
		}
	}
	if journal.Spec != 1 || len(journal.Files) == 0 {
		return errors.New("unsupported encrypted asset cleanup journal")
	}
	for _, file := range journal.Files {
		if !strings.HasPrefix(file.Path, "assets/") || path.Clean(file.Path) != file.Path || strings.Contains(file.Path, "\\") ||
			strings.Contains(file.Path, ":") || len(file.Hash) != 64 {
			return errors.New("invalid encrypted asset cleanup journal path")
		}
		if err = validateEncryptedCleanupPath(util.WorkspaceDir, filepath.Join(root, filepath.FromSlash(file.Path))); err != nil {
			return err
		}
		if err = validateEncryptedCleanupPath(util.DataDir, filepath.Join(util.DataDir, boxID, filepath.FromSlash(file.Path))); err != nil {
			return err
		}
	}
	if journal.Committed {
		return os.RemoveAll(root)
	}
	// 在复制前校验整批备份，损坏或冲突时保留恢复材料，不覆盖当前数据。
	for _, file := range journal.Files {
		backup := filepath.Join(root, filepath.FromSlash(file.Path))
		hash, hashErr := encryptedCleanupFileHash(backup)
		if hashErr != nil || hash != file.Hash {
			return fmt.Errorf("invalid encrypted asset cleanup backup: %s", file.Path)
		}
		live := filepath.Join(util.DataDir, boxID, filepath.FromSlash(file.Path))
		if hash, hashErr = encryptedCleanupFileHash(live); !errors.Is(hashErr, os.ErrNotExist) && (hashErr != nil || hash != file.Hash) {
			return fmt.Errorf("encrypted asset cleanup recovery conflicts with current file: %s", file.Path)
		}
	}
	for _, file := range journal.Files {
		live := filepath.Join(util.DataDir, boxID, filepath.FromSlash(file.Path))
		if _, statErr := os.Lstat(live); errors.Is(statErr, os.ErrNotExist) {
			if err = copyEncryptedCleanupFile(filepath.Join(root, filepath.FromSlash(file.Path)), live); err != nil {
				return err
			}
		}
	}
	return os.RemoveAll(root)
}

// copyEncryptedCleanupFile 原子复制密文并保留修改时间，复制失败只返回错误，不退出内核或覆盖源文件。
func copyEncryptedCleanupFile(source, target string) error {
	filelock.Lock(source)
	defer filelock.Unlock(source)
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("encrypted asset copy source must be a regular file")
	}
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	output, err := os.CreateTemp(filepath.Dir(target), ".asset-copy-*.tmp")
	if err != nil {
		return err
	}
	tmp := output.Name()
	defer func() {
		output.Close()
		os.Remove(tmp)
	}()
	if _, err = io.Copy(output, input); err != nil {
		return err
	}
	if err = output.Chmod(info.Mode().Perm()); err != nil {
		return err
	}
	if err = output.Sync(); err != nil {
		return err
	}
	if err = output.Close(); err != nil {
		return err
	}
	if err = os.Chtimes(tmp, info.ModTime(), info.ModTime()); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}

// validateEncryptedCleanupPath 拒绝恢复路径中的符号链接和非目录祖先，保留未认证的源文件与恢复材料。
func validateEncryptedCleanupPath(base, target string) error {
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errors.New("encrypted cleanup path escapes its root")
	}
	current := base
	parts := strings.Split(rel, string(filepath.Separator))
	for i, part := range parts {
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			return nil
		}
		if statErr != nil {
			return statErr
		}
		if info.Mode()&os.ModeSymlink != 0 || (i < len(parts)-1 && !info.IsDir()) {
			return fmt.Errorf("invalid encrypted cleanup path: %s", current)
		}
	}
	return nil
}

func recoverEncryptedAssetCleanupOperations() error {
	root := filepath.Dir(encryptedAssetCleanupDir("unused"))
	if err := validateEncryptedCleanupPath(util.WorkspaceDir, root); err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !ast.IsNodeIDPattern(entry.Name()) {
			return errors.New("invalid encrypted asset cleanup directory")
		}
		if err = recoverEncryptedAssetCleanup(entry.Name()); err != nil {
			return err
		}
	}
	return nil
}
