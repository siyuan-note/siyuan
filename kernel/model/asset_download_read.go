// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ResolveAssetPathWithMissingLeaf 校验尚未下载的路径，已存在的父目录仍须通过符号链接校验。
func ResolveAssetPathWithMissingLeaf(absPath string) (string, error) {
	current := filepath.Clean(absPath)
	var missing []string
	for {
		resolved, err := ResolveRealPath(current)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		if info, statErr := os.Lstat(current); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("asset path contains an unresolved symbolic link [%s]", current)
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
}

// deferredAssetPath 只解析同步清单，不访问网络，也不以未下载状态推断文件已删除。
func deferredAssetPath(relativePath, boxID string, includeEncrypted bool) (string, error) {
	files, err := DeferredSyncAssets()
	if err != nil {
		return "", err
	}
	return deferredAssetPathFromFiles(relativePath, boxID, includeEncrypted, files)
}

func deferredAssetPathFromFiles(relativePath, boxID string, includeEncrypted bool, files []*entity.File) (string, error) {
	relativePath = strings.TrimPrefix(path.Clean(filepath.ToSlash(relativePath)), "/")
	var candidates []string
	for _, file := range files {
		candidate := strings.TrimPrefix(file.Path, "/")
		lookupPath := candidate
		if boxID != "" {
			target := path.Join(boxID, relativePath)
			if candidate != target && !strings.HasPrefix(candidate, target+"/") {
				continue
			}
			lookupPath = target
		} else {
			switch {
			case candidate == relativePath, strings.HasSuffix(candidate, "/"+relativePath):
			case strings.HasPrefix(candidate, relativePath+"/"):
				lookupPath = relativePath
			case strings.Contains(candidate, "/"+relativePath+"/"):
				lookupPath = candidate[:strings.Index(candidate, "/"+relativePath+"/")+len(relativePath)+1]
			default:
				continue
			}
		}
		absPath := filepath.Join(util.DataDir, filepath.FromSlash(lookupPath))
		if !includeEncrypted && IsEncryptedAssetPath(absPath) {
			continue
		}
		if !gulu.File.IsSubPath(util.DataDir, absPath) {
			return "", errors.New("asset path escapes data directory")
		}
		if boxID == "" && !IsEncryptedAssetPath(absPath) {
			if _, _, resolveErr := ResolveDataAssetPath(lookupPath); resolveErr != nil {
				return "", resolveErr
			}
		} else {
			resolvedBoxID := boxID
			if resolvedBoxID == "" {
				resolvedBoxID = ExtractBoxIDFromAssetsPath(absPath)
			}
			root, rootErr := ResolveAssetPathWithMissingLeaf(filepath.Join(util.DataDir, resolvedBoxID, "assets"))
			resolved, resolveErr := ResolveAssetPathWithMissingLeaf(absPath)
			notebookRoot, notebookErr := ResolveRealPath(filepath.Join(util.DataDir, resolvedBoxID))
			dataRoot, dataErr := ResolveRealPath(util.DataDir)
			if rootErr != nil || resolveErr != nil || notebookErr != nil || dataErr != nil ||
				!gulu.File.IsSubPath(dataRoot, notebookRoot) ||
				!gulu.File.IsSubPath(notebookRoot, root) || !gulu.File.IsSubPath(root, resolved) {
				return "", errors.New("asset path resolves outside notebook assets directory")
			}
		}
		if lookupPath == relativePath {
			return absPath, nil
		}
		candidates = append(candidates, absPath)
	}
	sort.Strings(candidates)
	if len(candidates) > 0 {
		return candidates[0], nil
	}
	return "", nil
}

// ensureReadableAssetLocal 先检查加密笔记本准入，再下载原始密文；实际读取仍须认证解密。
func ensureReadableAssetLocal(absPath string) error {
	boxID := ExtractBoxIDFromAssetsPath(absPath)
	if boxID != "" && IsEncryptedBox(boxID) && !IsBoxUnlocked(boxID) {
		return errors.New(Conf.Language(314))
	}
	if gulu.File.IsSubPath(util.DataDir, absPath) {
		if err := EnsureAssetPrefixLocal(absPath); err != nil {
			return err
		}
	}
	return EnsureAssetLocal(absPath)
}

// prepareExportAssets 在导出持有笔记本读锁或生成产物之前补齐文档引用的资源。
func prepareExportAssets(boxID string, docPaths []string, includeFootnotes ...bool) error {
	if boxID != "" && IsEncryptedBox(boxID) && !IsBoxUnlocked(boxID) {
		return errors.New(Conf.Language(314))
	}
	deferred, err := DeferredSyncAssets()
	if err != nil || len(deferred) == 0 {
		return err
	}
	trees := map[string]*parse.Tree{}
	luteEngine := util.NewLute()
	for _, docPath := range docPaths {
		if !strings.HasSuffix(docPath, ".sy") {
			continue
		}
		targetBoxID := boxID
		rootID := util.GetTreeID(docPath)
		bt := getExportBlockTreeInBox(rootID, boxID)
		if bt == nil && !IsEncryptedBox(boxID) {
			bt = treenode.GetBlockTree(rootID)
		}
		if bt != nil {
			if boxID != "" && !IsSameCryptoBoundary(boxID, bt.BoxID) {
				return ErrTreeNotFound
			}
			targetBoxID, docPath = bt.BoxID, bt.Path
		}
		if targetBoxID == "" {
			continue
		}
		if IsEncryptedBox(targetBoxID) && !IsBoxUnlocked(targetBoxID) {
			return errors.New(Conf.Language(314))
		}
		tree, loadErr := filesys.LoadTree(targetBoxID, docPath, luteEngine)
		if loadErr != nil {
			return loadErr
		}
		exportRefTrees(tree, &[]string{}, trees)
	}
	// 查询嵌入的资源属于导出依赖，按笔记本边界展开并去重，避免循环嵌入反复读取。
	var pending []*parse.Tree
	queued := map[string]bool{}
	appendPending := func() {
		for id, tree := range trees {
			if !queued[id] {
				queued[id] = true
				pending = append(pending, tree)
			}
		}
	}
	appendPending()
	for i := 0; i < len(pending); i++ {
		tree := pending[i]
		if len(includeFootnotes) != 0 && includeFootnotes[0] && Conf.Export.BlockRefMode == 4 {
			// 按单文件导出的脚注展开规则收集资源，不受是否另行导出关联文档影响
			order := []string{}
			footnotes := map[string]*refAsFootnotes{}
			depth := 0
			collectFootnotesDefs(tree, tree.ID, &order, footnotes, &depth)
			defs := resolveFootnotesDefs(&order, footnotes, tree, map[string]bool{},
				Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight)
			if defs != nil {
				footnoteTree := *tree
				footnoteTree.ID, footnoteTree.Root = tree.ID+"-footnotes", defs
				trees[footnoteTree.ID] = &footnoteTree
			}
		}
		treenode.WalkWithTabTitles(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || node.Type != ast.NodeBlockQueryEmbedScript {
				return ast.WalkContinue
			}
			stmt := strings.ReplaceAll(html.UnescapeString(node.TokensStr()), editor.IALValEscNewLine, "\n")
			var blocks []*sql.Block
			if IsEncryptedBox(tree.Box) {
				blocks = sql.SelectBlocksRawStmtInBox(stmt, 1, Conf.Search.Limit, tree.Box)
			} else {
				blocks = sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
			}
			for _, block := range blocks {
				if embedded, loadErr := loadExportRelatedTree(block.ID, tree.Box); loadErr == nil {
					exportRefTrees(embedded, &[]string{}, trees)
				}
			}
			return ast.WalkContinue
		})
		appendPending()
	}
	assets := map[string]bool{}
	for _, tree := range trees {
		dests := getAssetsLinkDests(tree.Root, false)
		avBoxID := ""
		if IsEncryptedBox(tree.Box) {
			avBoxID = tree.Box
		}
		avIDs := hashset.New()
		treenode.WalkWithTabTitles(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.Type == ast.NodeAttributeView && node.AttributeViewID != "" {
				walkRelationAvs(node.AttributeViewID, avBoxID, avIDs)
			}
			return ast.WalkContinue
		})
		for _, id := range avIDs.Values() {
			attrView, parseErr := av.ParseAttributeViewInBox(id.(string), avBoxID)
			if parseErr != nil {
				return parseErr
			}
			dests = append(dests, getAttributeViewAssetsLinkDests(attrView, false, nil)...)
		}
		if titleImage := treenode.GetDocTitleImgPath(tree.Root); titleImage != "" {
			dests = append(dests, titleImage)
		}
		for _, dest := range dests {
			dest = string(html.DecodeDestination([]byte(dest)))
			if fragment := strings.IndexByte(dest, '#'); fragment >= 0 {
				dest = dest[:fragment]
			}
			if !strings.HasPrefix(AssetPathWithoutQuery(dest), "assets/") {
				continue
			}
			absPath, resolveErr := GetAssetAbsPathInBox(dest, tree.Box)
			if resolveErr != nil {
				return resolveErr
			}
			assets[absPath] = true
		}
	}
	for absPath := range assets {
		if err = EnsureAssetPrefixLocal(absPath); err != nil {
			return fmt.Errorf("prepare export asset [%s]: %w", filepath.Base(absPath), err)
		}
	}
	return nil
}

func prepareExportBlockAssets(id string, includeSubDocs bool) error {
	bt := getExportBlockTree(id)
	if bt == nil {
		return nil
	}
	docPaths := []string{bt.Path}
	if includeSubDocs {
		if box := Conf.Box(bt.BoxID); box != nil {
			listPath := strings.TrimSuffix(bt.Path, ".sy")
			if IsBoxDoc(bt.BoxID, bt.RootID) {
				listPath = "/"
			}
			for _, file := range box.ListFiles(listPath) {
				docPaths = append(docPaths, file.path)
			}
		}
	}
	return prepareExportAssets(bt.BoxID, docPaths, true)
}
