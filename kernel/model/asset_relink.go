// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetRelinkFile struct {
	path   string
	before []byte
	tree   *parse.Tree
	view   *av.AttributeView
	after  []byte
}

type assetRelinkPlan struct {
	*assetRelinker
	files []*assetRelinkFile
	trees []*parse.Tree
	ocr   bool
}

func newAssetRelinker(oldPath, newPath string) (*assetRelinker, error) {
	r := &assetRelinker{result: apicontract.AssetReferencesData{
		References: []apicontract.AssetReference{}, SkippedNotebooks: []string{},
	}}
	for i, raw := range []string{oldPath, newPath} {
		if i == 1 && raw == "" {
			continue
		}
		p, err := relinkPath(raw)
		if err != nil {
			return r, err
		}
		u, _ := url.Parse(raw)
		if u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(raw, "#") {
			return r, errors.New("request paths must not contain query parameters or fragments; encrypted assets are not supported")
		}
		if i == 0 {
			r.oldPath = p
		} else {
			r.newPath = p
		}
	}
	return r, nil
}

func FindAssetReferences(assetPath string) (apicontract.AssetReferencesData, error) {
	return runAssetRelink(assetPath, "", true)
}

func RelinkAsset(oldPath, newPath string, dryRun bool) (apicontract.AssetReferencesData, error) {
	if newPath == "" {
		return apicontract.AssetReferencesData{References: []apicontract.AssetReference{}, SkippedNotebooks: []string{}}, errors.New("newPath is required")
	}
	return runAssetRelink(oldPath, newPath, dryRun)
}

func runAssetRelink(oldPath, newPath string, dryRun bool) (apicontract.AssetReferencesData, error) {
	r, err := newAssetRelinker(oldPath, newPath)
	r.result.DryRun = dryRun
	if err != nil {
		return r.result, err
	}
	// 与同步及编辑事务串行，扫描直接读取持久化源，预演不修复或写入文档。
	syncLock.Lock()
	defer syncLock.Unlock()
	FlushTxQueue()
	flushLock.Lock()
	defer flushLock.Unlock()
	p := &assetRelinkPlan{assetRelinker: r}
	if err = p.scan(); err != nil {
		return r.result, err
	}
	if dryRun || newPath == "" || r.oldPath == r.newPath {
		return r.result, nil
	}
	for _, reference := range r.result.References {
		if !reference.Relinkable {
			return r.result, fmt.Errorf("asset relink blocked: %s (%s)", reference.Reason, reference.Path)
		}
	}
	if len(p.files) == 0 && !p.ocr {
		return r.result, nil
	}
	err = p.apply()
	return r.result, err
}

func (p *assetRelinkPlan) scan() error {
	entries, err := os.ReadDir(util.DataDir)
	if err != nil {
		return err
	}
	var assetRoots []string
	assetRoots = append(assetRoots, filepath.Join(util.DataDir, "assets"))
	luteEngine := util.NewLute()
	titles := map[string]string{}
	for _, entry := range entries {
		boxID := entry.Name()
		if !entry.IsDir() || !ast.IsNodeIDPattern(boxID) {
			continue
		}
		if IsEncryptedBox(boxID) {
			p.result.SkippedNotebooks = append(p.result.SkippedNotebooks, boxID)
			continue
		}
		boxDir := filepath.Join(util.DataDir, boxID)
		err = filepath.WalkDir(boxDir, func(absPath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("symbolic links in notebook are not supported: %s", absPath)
			}
			if entry.IsDir() {
				if entry.Name() == "assets" {
					assetRoots = append(assetRoots, absPath)
					return filepath.SkipDir
				}
				if strings.HasPrefix(entry.Name(), ".") || entry.Name() == "storage" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(entry.Name(), ".sy") {
				return nil
			}
			data, readErr := filelock.ReadFile(absPath)
			if readErr != nil {
				return readErr
			}
			if util.IsCiphertext(data) {
				return fmt.Errorf("encrypted document in ordinary notebook: %s", absPath)
			}
			if readErr = treenode.CheckSpecJSON(data); readErr != nil {
				return readErr
			}
			tree, readErr := dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
			if readErr != nil || tree == nil || tree.Root == nil {
				return fmt.Errorf("cannot parse document %s: %v", absPath, readErr)
			}
			rel, _ := filepath.Rel(boxDir, absPath)
			tree.Box, tree.Path = boxID, "/"+filepath.ToSlash(rel)
			tree.Root.Box, tree.Root.Path = tree.Box, tree.Path
			tree.HPath = "/" + tree.Root.IALAttr("title")
			if readErr = filesys.NormalizeTreeForRead(tree); readErr != nil {
				return readErr
			}
			if tree.Root.ID != strings.TrimSuffix(entry.Name(), ".sy") {
				return fmt.Errorf("document ID does not match path: %s", absPath)
			}
			titles[tree.Root.ID] = tree.Root.IALAttr("title")
			before := len(p.result.References)
			p.tree(tree, apicontract.AssetReference{Notebook: boxID, RootID: tree.Root.ID, Path: tree.Path})
			retain := false
			if len(p.result.References) > before {
				p.files = append(p.files, &assetRelinkFile{path: absPath, before: data, tree: tree})
				retain = true
			}
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.Type == ast.NodeAttributeView {
					retain = true
				}
				return ast.WalkContinue
			})
			if retain {
				p.trees = append(p.trees, tree)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	for _, tree := range p.trees {
		parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(tree.Path, "/"), ".sy"), "/")
		for i, id := range parts {
			if title, ok := titles[id]; ok {
				parts[i] = title
			}
		}
		tree.HPath = "/" + strings.Join(parts, "/")
	}
	oldAbs, err := resolveRelinkAsset(assetRoots, p.oldPath, false)
	if err != nil {
		return err
	}
	newAbs := ""
	if p.newPath != "" {
		if newAbs, err = resolveRelinkAsset(assetRoots, p.newPath, true); err != nil {
			return err
		}
	}
	if err = p.scanViews(); err != nil {
		return err
	}
	if err = p.scanAnnotation(oldAbs, newAbs); err != nil {
		return err
	}
	if exists, ocrErr := util.CopyAssetTextForRelink(p.oldPath, p.newPath, "", true); exists || ocrErr != nil {
		ref := apicontract.AssetReference{Type: "ocr", Path: "assets/ocr-texts.json", Reference: p.oldPath, Replacement: p.newPath, Relinkable: ocrErr == nil}
		if ocrErr != nil {
			ref.Reason = ocrErr.Error()
		}
		p.result.References = append(p.result.References, ref)
		p.ocr = exists && ocrErr == nil && p.newPath != ""
	}
	return nil
}

// resolveRelinkAsset 拒绝同名资源歧义，避免把不同目录下的文件视为同一个资源。
func resolveRelinkAsset(roots []string, assetPath string, required bool) (string, error) {
	var found string
	for _, root := range roots {
		candidate := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(assetPath, "assets/")))
		info, err := os.Stat(candidate)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("asset must be a regular file: %s", assetPath)
		}
		real, err := filepath.EvalSymlinks(candidate)
		if err != nil {
			return "", err
		}
		realRoot, err := filepath.EvalSymlinks(root)
		if err != nil || !gulu.File.IsSubPath(realRoot, real) {
			return "", fmt.Errorf("asset escapes its directory: %s", assetPath)
		}
		if err = validateRelinkStoragePath(real); err != nil {
			return "", err
		}
		if IsEncryptedAssetPath(real) {
			return "", errors.New("encrypted assets are not supported")
		}
		if found != "" && found != candidate {
			return "", fmt.Errorf("ambiguous asset path: %s", assetPath)
		}
		found = candidate
	}
	if required && found == "" {
		return "", fmt.Errorf("target asset does not exist locally: %s", assetPath)
	}
	return found, nil
}

func (p *assetRelinkPlan) scanViews() error {
	dir := filepath.Join(util.DataDir, "storage", "av")
	entries, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !ast.IsNodeIDPattern(id) {
			continue
		}
		abs := filepath.Join(dir, entry.Name())
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic attribute view is not supported: %s", id)
		}
		if err = validateRelinkStoragePath(abs); err != nil {
			return err
		}
		data, err := filelock.ReadFile(abs)
		if err != nil {
			return err
		}
		if util.IsCiphertext(data) {
			return fmt.Errorf("encrypted attribute view in global storage: %s", id)
		}
		cache.RemoveAVData(id)
		view, err := av.ParseAttributeViewByPath(abs)
		if err != nil || view == nil || view.ID != id {
			return fmt.Errorf("cannot parse attribute view %s: %v", id, err)
		}
		before := len(p.result.References)
		if err = p.attributeView(view, apicontract.AssetReference{AvID: id, Path: "storage/av/" + entry.Name()}); err != nil {
			return err
		}
		if len(p.result.References) > before {
			p.files = append(p.files, &assetRelinkFile{path: abs, before: data, view: view})
			owners := []apicontract.AssetReference{}
			for _, tree := range p.trees {
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering && n.Type == ast.NodeAttributeView && n.AttributeViewID == id {
						owners = append(owners, apicontract.AssetReference{Notebook: tree.Box, RootID: tree.Root.ID, BlockID: n.ID})
					}
					return ast.WalkContinue
				})
			}
			if len(owners) > 0 {
				references := append([]apicontract.AssetReference(nil), p.result.References[before:]...)
				p.result.References = p.result.References[:before]
				for _, reference := range references {
					for _, owner := range owners {
						located := reference
						located.Notebook, located.RootID = owner.Notebook, owner.RootID
						if located.BlockID == "" {
							located.BlockID = owner.BlockID
						}
						p.result.References = append(p.result.References, located)
					}
				}
			}
		}
	}
	for _, tree := range p.trees {
		var missing string
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.Type == ast.NodeAttributeView {
				if !ast.IsNodeIDPattern(n.AttributeViewID) || !filelock.IsExist(filepath.Join(dir, n.AttributeViewID+".json")) {
					missing = n.AttributeViewID
				}
			}
			return ast.WalkContinue
		})
		if missing != "" {
			return fmt.Errorf("attribute view is unavailable: %s", missing)
		}
	}
	return nil
}

func (p *assetRelinkPlan) scanAnnotation(oldAbs, newAbs string) error {
	if oldAbs == "" {
		for i := range p.result.References {
			if p.result.References[i].Type == "annotation" {
				p.result.References[i].Relinkable, p.result.References[i].Reason = false, "annotation_source_missing"
			}
		}
		return nil
	}
	source := oldAbs + ".sya"
	if _, statErr := os.Stat(source); statErr == nil {
		if err := validateRelinkStoragePath(source); err != nil {
			return err
		}
	}
	data, err := filelock.ReadFile(source)
	if os.IsNotExist(err) {
		for i := range p.result.References {
			if p.result.References[i].Type == "annotation" {
				p.result.References[i].Relinkable, p.result.References[i].Reason = false, "annotation_file_missing"
			}
		}
		return nil
	}
	if err != nil {
		return err
	}
	if !json.Valid(data) || util.IsCiphertext(data) {
		return errors.New("invalid annotation file")
	}
	p.files = append(p.files, &assetRelinkFile{path: source, before: data})
	ref := apicontract.AssetReference{Type: "annotation-file", Path: p.oldPath + ".sya", Reference: p.oldPath, Relinkable: true}
	if p.newPath != "" {
		ref.Replacement = p.newPath
		if !strings.EqualFold(filepath.Ext(p.newPath), ".pdf") {
			ref.Relinkable, ref.Reason = false, "annotation_requires_pdf"
		} else if target, readErr := filelock.ReadFile(newAbs + ".sya"); readErr == nil {
			if !bytes.Equal(data, target) {
				ref.Relinkable, ref.Reason = false, "annotation_target_conflict"
			}
		} else if !os.IsNotExist(readErr) {
			return readErr
		} else {
			p.files = append(p.files, &assetRelinkFile{path: newAbs + ".sya", after: data})
		}
	}
	p.result.References = append(p.result.References, ref)
	return nil
}

func (p *assetRelinkPlan) apply() (err error) {
	// 所有源文件先备份成功，再写入任何引用；错误响应保留历史目录，支持中断后恢复。
	historyDir, err := newAssetRelinkHistoryDir()
	if err != nil {
		return err
	}
	p.result.HistoryPath = filepath.ToSlash(historyDir)
	for _, file := range p.files {
		current, readErr := filelock.ReadFile(file.path)
		if file.before == nil {
			if !os.IsNotExist(readErr) {
				return fmt.Errorf("annotation target changed during scan: %s", file.path)
			}
			continue
		}
		if readErr != nil || !bytes.Equal(current, file.before) {
			return fmt.Errorf("source changed during scan: %s", file.path)
		}
		rel, relErr := filepath.Rel(util.DataDir, file.path)
		if relErr != nil || strings.HasPrefix(rel, "..") {
			return errors.New("invalid history source path")
		}
		dest := filepath.Join(historyDir, rel)
		if err = os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		if err = gulu.File.WriteFileSafer(dest, file.before, 0644); err != nil {
			return err
		}
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	changedViews := map[string]bool{}
	reload := map[string]bool{}
	defer func() {
		for _, tree := range p.trees {
			viewChanged := false
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.Type == ast.NodeAttributeView && changedViews[n.AttributeViewID] {
					reload[tree.Root.ID] = true
					viewChanged = true
				}
				return ast.WalkContinue
			})
			if viewChanged {
				if current, loadErr := filesys.LoadTree(tree.Box, tree.Path, util.NewLute()); loadErr == nil {
					sql.UpsertTreeQueue(current)
				} else {
					err = errors.Join(err, loadErr)
				}
			}
		}
		sql.FlushQueue()
		for id := range reload {
			ReloadProtyle(id)
		}
		if p.result.Updated > 0 {
			IncSync()
		}
	}()
	// 先创建标注附属文件，使后续文档引用在部分失败时仍可解析。
	for _, file := range p.files {
		if file.before != nil {
			continue
		}
		if err = util.WriteFileIfUnchanged(file.path, nil, file.after); err != nil {
			return err
		}
		p.result.Updated++
	}
	if p.ocr {
		if _, err = util.CopyAssetTextForRelink(p.oldPath, p.newPath, historyDir, false); err != nil {
			return err
		}
		p.result.Updated++
	}
	for _, file := range p.files {
		if file.tree != nil {
			var size uint64
			if size, err = filesys.WriteTreeIfUnchanged(file.tree, file.before); err != nil {
				return err
			}
			sql.UpsertTreeQueue(file.tree)
			refreshDocInfoWithSize(file.tree, size)
			reload[file.tree.Root.ID] = true
		} else if file.view != nil {
			if err = av.SaveAttributeViewIfUnchanged(file.view, file.before); err != nil {
				return err
			}
			changedViews[file.view.ID] = true
		} else {
			continue
		}
		p.result.Updated++
	}
	return nil
}

func newAssetRelinkHistoryDir() (string, error) {
	if err := os.MkdirAll(util.HistoryDir, 0755); err != nil {
		return "", err
	}
	for offset := 0; offset < 1000; offset++ {
		dir := filepath.Join(util.HistoryDir, time.Now().Add(time.Duration(offset)*time.Second).Format("2006-01-02-150405")+"-"+HistoryOpReplace)
		if err := os.Mkdir(dir, 0755); err == nil {
			return dir, nil
		} else if !os.IsExist(err) {
			return "", err
		}
	}
	return "", errors.New("cannot allocate a replacement history directory")
}

func validateRelinkStoragePath(abs string) error {
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return err
	}
	dataRoot, err := filepath.EvalSymlinks(util.DataDir)
	if err != nil || !gulu.File.IsSubPath(dataRoot, real) {
		return fmt.Errorf("resource escapes the data directory: %s", abs)
	}
	rel, err := filepath.Rel(dataRoot, real)
	if err != nil {
		return err
	}
	first, _, _ := strings.Cut(filepath.ToSlash(rel), "/")
	if ast.IsNodeIDPattern(first) && IsEncryptedBox(first) {
		return errors.New("encrypted resources are not supported")
	}
	return nil
}
