package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type duplicateDocTreePlan struct {
	boxID        string
	sourcePath   string
	sourcePaths  []string
	fingerprints map[string][sha256.Size]byte
	trees        []*parse.Tree
	ids          map[string]string
	avNodes      []*ast.Node
}

// DuplicateDocTree 在原父目录创建完整副本，正文内部关联指向副本，数据库保留镜像及原行绑定。
func DuplicateDocTree(id string) (*parse.Tree, error) {
	FlushTxQueue()
	bt := treenode.GetBlockTree(id)
	if bt == nil || bt.ID != bt.RootID || IsBoxDoc(bt.BoxID, id) {
		return nil, fmt.Errorf("document [%s] not found or cannot be duplicated", id)
	}
	if err := AcquireEncryptedBoxOperation(bt.BoxID); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(bt.BoxID)
	msgID := util.PushMsg(Conf.Language(116), 30000)
	defer util.PushClearMsg(msgID)

	// 编辑事务及路径刷新暂停期间读取快照，防止准备过程中混入不同版本的正文。
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()
	plan, err := prepareDuplicateDocTree(bt.BoxID, bt.Path)
	if err != nil {
		return nil, err
	}
	if err = plan.commit(filesys.WriteTree); err != nil {
		return nil, err
	}
	for _, tree := range plan.trees {
		treenode.UpsertBlockTree(tree)
	}
	for _, tree := range plan.trees {
		sql.UpsertTreeQueue(tree)
		refreshDocInfoWithoutParent(tree)
	}
	root := plan.trees[0]
	refreshParentDocInfo(root)
	refreshBoxDocInfo(root)
	IncSync()
	PushCreate(Conf.Box(root.Box), root.Path, map[string]any{"listDocTree": true})
	return root, nil
}

// duplicateDocTreePaths 仅枚举文档目录，拒绝链接及缺少父文档的目录，忽略资源等非文档目录。
func duplicateDocTreePaths(boxID, rootPath string) ([]string, error) {
	if _, err := filesys.ValidateBoxRelativePath(boxID, rootPath); err != nil {
		return nil, err
	}
	var paths []string
	var visit func(string) error
	visit = func(p string) error {
		abs := filepath.Join(util.DataDir, boxID, p)
		info, err := os.Lstat(abs)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || !ast.IsNodeIDPattern(util.GetTreeID(p)) {
			return fmt.Errorf("invalid document path [%s]", p)
		}
		paths = append(paths, p)
		dir := strings.TrimSuffix(abs, ".sy")
		info, err = os.Lstat(dir)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("invalid document directory [%s]", dir)
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Type()&os.ModeSymlink != 0 && (ast.IsNodeIDPattern(entry.Name()) || strings.HasSuffix(entry.Name(), ".sy")) {
				return fmt.Errorf("invalid document link [%s]", entry.Name())
			}
			if entry.IsDir() && ast.IsNodeIDPattern(entry.Name()) {
				if _, err = os.Stat(filepath.Join(dir, entry.Name()+".sy")); err != nil {
					return err
				}
			}
			if strings.HasSuffix(entry.Name(), ".sy") {
				if err = visit(path.Join(strings.TrimSuffix(p, ".sy"), entry.Name())); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(rootPath); err != nil {
		return nil, err
	}
	return paths, nil
}

func prepareDuplicateDocTree(boxID, rootPath string) (*duplicateDocTreePlan, error) {
	paths, err := duplicateDocTreePaths(boxID, rootPath)
	if err != nil {
		return nil, err
	}
	plan := &duplicateDocTreePlan{boxID: boxID, sourcePath: rootPath, sourcePaths: paths,
		fingerprints: map[string][sha256.Size]byte{}, ids: map[string]string{}}
	for _, p := range paths {
		tree, fingerprint, readErr := filesys.ReadTreeSnapshot(boxID, p)
		if readErr != nil {
			return nil, fmt.Errorf("read document [%s]: %w", p, readErr)
		}
		plan.fingerprints[p] = fingerprint
		plan.trees = append(plan.trees, tree)
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}
			if !ast.IsNodeIDPattern(n.ID) || plan.ids[n.ID] != "" {
				err = fmt.Errorf("invalid or duplicate source block ID [%s]", n.ID)
				return ast.WalkStop
			}
			plan.ids[n.ID] = ast.NewNodeID()
			return ast.WalkContinue
		})
		if err != nil {
			return nil, err
		}
	}
	hpaths := map[string]string{}
	for i, tree := range plan.trees {
		originalPath := tree.Path
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.IsBlock() {
				n.ID = plan.ids[n.ID]
				n.SetIALAttr("id", n.ID)
				n.SetIALAttr("updated", util.TimeFromID(n.ID))
				n.RemoveIALAttr(av.NodeAttrNameAvs)
				n.RemoveIALAttr(av.NodeAttrViewNames)
				n.RemoveIALAttrsByPrefix(av.NodeAttrViewStaticText)
				n.RemoveIALAttr(NodeAttrRiffDecks)
			}
			if entering && n.Type == ast.NodeAttributeView {
				plan.avNodes = append(plan.avNodes, n)
			}
			return ast.WalkContinue
		})
		tree.ID = tree.Root.ID
		tree.Root.RemoveIALAttr("scroll")
		if i == 0 {
			title := tree.Root.IALAttr("title") + " (Duplicated " + time.Now().Format("2006-01-02 15:04:05") + ")"
			tree.Root.SetIALAttr("title", title)
			tree.HPath = path.Join(path.Dir(tree.HPath), title)
		} else {
			tree.HPath = hpaths[path.Dir(originalPath)+".sy"] + "/" + tree.Root.IALAttr("title")
		}
		hpaths[originalPath] = tree.HPath
		parts := strings.Split(strings.TrimSuffix(originalPath, ".sy"), "/")
		for j, part := range parts {
			if mapped := plan.ids[part]; mapped != "" {
				parts[j] = mapped
			}
		}
		tree.Path = strings.Join(parts, "/") + ".sy"
		tree.Root.Path = tree.Path
		remapDuplicateDocTreeReferences(tree.Root, plan.ids)
		if err = treenode.SyncTableCellRichInlineChanges(tree.Root); err != nil {
			return nil, err
		}
	}
	return plan, nil
}

var duplicateDocTreeBlockID = regexp.MustCompile(`\b[0-9]{14}-[a-z0-9]{7}\b`)

func remapDuplicateDocTreeReferences(root *ast.Node, ids map[string]string) {
	treenode.RemapTabsActiveIDs(root, ids)
	remapLink := func(link string) string {
		const prefix = "siyuan://blocks/"
		if !strings.HasPrefix(link, prefix) {
			return link
		}
		id := strings.TrimPrefix(link, prefix)
		end := strings.IndexAny(id, "?#")
		if end < 0 {
			end = len(id)
		}
		if mapped := ids[id[:end]]; mapped != "" {
			return prefix + mapped + id[end:]
		}
		return link
	}
	treenode.WalkWithTabTitles(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n.Type == ast.NodeTextMark && n.IsTextMarkType("block-ref") {
			if mapped := ids[n.TextMarkBlockRefID]; mapped != "" {
				n.TextMarkBlockRefID = mapped
			}
		} else if n.Type == ast.NodeBlockRefID {
			if mapped := ids[n.TokensStr()]; mapped != "" {
				n.Tokens = []byte(mapped)
			}
		}
		if n.IsTextMarkType("a") {
			n.TextMarkAHref = remapLink(n.TextMarkAHref)
		} else if n.Type == ast.NodeLinkDest {
			n.Tokens = []byte(remapLink(n.TokensStr()))
		} else if n.Type == ast.NodeBlockQueryEmbedScript {
			n.Tokens = duplicateDocTreeBlockID.ReplaceAllFunc(n.Tokens, func(match []byte) []byte {
				if mapped := ids[string(match)]; mapped != "" {
					return []byte(mapped)
				}
				return match
			})
		}
		return ast.WalkContinue
	})
}

func (plan *duplicateDocTreePlan) validateSources() error {
	paths, err := duplicateDocTreePaths(plan.boxID, plan.sourcePath)
	if err != nil {
		return err
	}
	if !slices.Equal(paths, plan.sourcePaths) {
		return errors.New("source document tree changed during duplication")
	}
	for p, fingerprint := range plan.fingerprints {
		data, readErr := filelock.ReadFile(filepath.Join(util.DataDir, plan.boxID, p))
		if readErr != nil {
			return readErr
		}
		if sha256.Sum256(data) != fingerprint {
			return fmt.Errorf("source document [%s] changed during duplication", p)
		}
	}
	return nil
}

// commit 先写入全部文档，最后更新排序和镜像关系；失败时仅移除本次尝试创建的文件。
func (plan *duplicateDocTreePlan) commit(writeTree func(*parse.Tree) (uint64, error)) (err error) {
	if err = plan.validateSources(); err != nil {
		return
	}
	sortPath := filepath.Join(util.DataDir, plan.boxID, ".siyuan", "sort.json")
	sorts, err := readSortConfMap(sortPath)
	if err != nil {
		return
	}
	previousSortData, readErr := filelock.ReadFile(sortPath)
	if readErr != nil && !os.IsNotExist(readErr) {
		return readErr
	}
	for _, tree := range plan.trees {
		for _, p := range []string{tree.Path, strings.TrimSuffix(tree.Path, ".sy")} {
			if _, statErr := os.Lstat(filepath.Join(util.DataDir, plan.boxID, p)); !os.IsNotExist(statErr) {
				return fmt.Errorf("duplicate target already exists or is inaccessible [%s]", p)
			}
		}
	}
	var attempted []*parse.Tree
	sortWritten := false
	defer func() {
		if err == nil {
			return
		}
		if sortWritten {
			if readErr == nil {
				err = errors.Join(err, filelock.WriteFile(sortPath, previousSortData))
			} else if removeErr := os.Remove(sortPath); removeErr != nil && !os.IsNotExist(removeErr) {
				err = errors.Join(err, removeErr)
			}
		}
		for i := len(attempted) - 1; i >= 0; i-- {
			tree := attempted[i]
			abs := filepath.Join(util.DataDir, tree.Box, tree.Path)
			if removeErr := os.Remove(abs); removeErr != nil && !os.IsNotExist(removeErr) {
				err = errors.Join(err, removeErr)
			}
			cache.RemoveTreeDataInBox(tree.ID, tree.Box)
			cache.RemoveDocIALInBox(tree.Path, tree.Box)
			treenode.RemoveBlockTreesByRootID(tree.Box, tree.ID)
			// 只删除空的副本目录，保留并发写入或无法清理的数据。
			if i > 0 {
				_ = os.Remove(filepath.Dir(abs))
			}
		}
	}()
	for _, tree := range plan.trees {
		attempted = append(attempted, tree)
		if _, err = writeTree(tree); err != nil {
			return
		}
	}
	if err = plan.validateSources(); err != nil {
		return
	}
	// 每层排序使用源列表的有效自定义顺序，避免相同排序值的新 ID 改变相对位置。
	parents := map[string]bool{path.Dir(plan.sourcePath): true}
	for _, p := range plan.sourcePaths[1:] {
		parents[path.Dir(p)] = true
	}
	for parent := range parents {
		order, orderErr := loadSiblingCustomOrder(plan.boxID, parent, sorts)
		if orderErr != nil {
			return orderErr
		}
		if parent == path.Dir(plan.sourcePath) {
			newID := plan.trees[0].ID
			order = slices.DeleteFunc(order, func(id string) bool { return id == newID })
			index := slices.Index(order, util.GetTreeID(plan.sourcePath))
			order = slices.Insert(order, index+1, newID)
			for i, id := range order {
				sorts[id] = i + 1
			}
		} else {
			for i, id := range order {
				if mapped := plan.ids[id]; mapped != "" {
					sorts[mapped] = i + 1
				}
			}
		}
	}
	sortWritten = true
	if err = writeSortConfMap(sortPath, sorts); err != nil {
		return
	}
	avBoxID := ""
	if IsEncryptedBox(plan.boxID) {
		avBoxID = plan.boxID
	}
	err = av.AddCopiedBlockRels(avBoxID, plan.avNodes)
	return
}
