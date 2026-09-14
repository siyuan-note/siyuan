// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
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
	"github.com/ClarkThan/ahocorasick"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetRelinkFile struct {
	path       string
	before     []byte
	tree       *parse.Tree
	view       *av.AttributeView
	after      []byte
	items      map[*assetRelinkItem]bool
	backupOnly bool
	conflict   bool
}

type assetRelinkPlan struct {
	*assetRelinker
	files           []*assetRelinkFile
	trees           []*parse.Tree
	items           []*assetRelinkItem
	ocrPlan         *util.AssetTextRelinkPlan
	ctx             context.Context
	batch           bool
	lookup          bool
	inventory       map[string]assetRelinkStamp
	parsedDocuments int
	parsedViews     int
	progress        func(string)
	saving          bool
	matcher         *ahocorasick.Matcher
	itemByPath      map[string]*assetRelinkItem
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
	return runAssetRelinks(context.Background(), []apicontract.AssetRelinkMapping{{OldPath: oldPath, NewPath: newPath}}, dryRun, newPath == "", false)
}

func (p *assetRelinkPlan) scan() error {
	p.initialize()
	if err := p.observe(util.DataDir); err != nil {
		return err
	}
	entries, err := os.ReadDir(util.DataDir)
	if err != nil {
		return err
	}
	var assetRoots []string
	assetRoots = append(assetRoots, filepath.Join(util.DataDir, "assets"))
	luteEngine := util.NewLute()
	titles := map[string]string{}
	for _, entry := range entries {
		if err := p.checkContext(); err != nil {
			return err
		}
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
			if err := p.checkContext(); err != nil {
				return err
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("symbolic links in notebook are not supported: %s", absPath)
			}
			if entry.IsDir() {
				if err := p.observe(absPath); err != nil {
					return err
				}
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
			if err := p.observe(absPath); err != nil {
				return err
			}
			p.reportProgress(absPath)
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
			if !json.Valid(data) {
				return fmt.Errorf("invalid document JSON: %s", absPath)
			}
			var header struct {
				ID         string `json:"ID"`
				Properties struct {
					Title string `json:"title"`
				} `json:"Properties"`
			}
			if readErr = json.Unmarshal(data, &header); readErr != nil {
				return readErr
			}
			titles[header.ID] = header.Properties.Title
			if !p.mayContainReferences(data) && !bytes.Contains(data, []byte("NodeAttributeView")) {
				return nil
			}
			p.parsedDocuments++
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
				p.files = append(p.files, &assetRelinkFile{path: absPath, before: data, tree: tree, items: p.referenceItems(before)})
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
	if err = p.scanViews(); err != nil {
		return err
	}
	p.finishPreflight()
	return p.scanMetadata(assetRoots)
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
	if err := p.observe(dir); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, entry := range entries {
		if err := p.checkContext(); err != nil {
			return err
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !ast.IsNodeIDPattern(id) {
			continue
		}
		abs := filepath.Join(dir, entry.Name())
		if err = p.observe(abs); err != nil {
			return err
		}
		p.reportProgress(abs)
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
		if !json.Valid(data) {
			return fmt.Errorf("invalid attribute view JSON: %s", id)
		}
		if !p.mayContainReferences(data) {
			continue
		}
		p.parsedViews++
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
			p.files = append(p.files, &assetRelinkFile{path: abs, before: data, view: view, items: p.referenceItems(before)})
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
	availability := map[string]string{}
	boxNames := map[string]string{}
	for _, tree := range p.trees {
		var checkErr error
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || n.Type != ast.NodeAttributeView {
				return ast.WalkContinue
			}
			reason, checked := availability[n.AttributeViewID]
			if !checked {
				if !ast.IsNodeIDPattern(n.AttributeViewID) {
					reason = "invalid_id"
				} else {
					abs := filepath.Join(dir, n.AttributeViewID+".json")
					if checkErr = p.observe(abs); checkErr != nil {
						return ast.WalkStop
					}
					info, statErr := os.Lstat(abs)
					if os.IsNotExist(statErr) {
						// 数据库定义不参与资源按需下载；缺失定义作为历史残留上报，保留数据库块。
						reason = "missing_definition"
					} else if statErr != nil {
						checkErr = statErr
						return ast.WalkStop
					} else if !info.Mode().IsRegular() {
						checkErr = fmt.Errorf("attribute view definition is not a regular file: %s", abs)
						return ast.WalkStop
					}
				}
				availability[n.AttributeViewID] = reason
			}
			if reason != "" {
				name, loaded := boxNames[tree.Box]
				if !loaded {
					name = (&Box{ID: tree.Box}).GetConf().Name
					boxNames[tree.Box] = name
				}
				p.result.UnavailableAttributeViews = append(p.result.UnavailableAttributeViews, apicontract.UnavailableAssetAttributeView{
					AvID: n.AttributeViewID, Notebook: tree.Box, NotebookName: name, RootID: tree.Root.ID,
					BlockID: n.ID, Path: tree.Path, HPath: tree.HPath, Reason: reason,
				})
			}
			return ast.WalkContinue
		})
		if checkErr != nil {
			return fmt.Errorf("cannot inspect attribute view in notebook %s, document %s: %w", tree.Box, tree.Path, checkErr)
		}
	}
	return nil
}

func (p *assetRelinkPlan) scanAnnotation(oldAbs, newAbs string) error {
	if oldAbs == "" {
		for i := range p.result.References {
			if p.result.References[i].Type == "annotation" && p.result.References[i].OldPath == p.oldPath {
				p.result.References[i].Relinkable, p.result.References[i].Reason = false, "annotation_source_missing"
			}
		}
		return nil
	}
	source := oldAbs + ".sya"
	if err := p.observe(source); err != nil {
		return err
	}
	if newAbs != "" {
		if err := p.observe(newAbs + ".sya"); err != nil {
			return err
		}
	}
	if _, statErr := os.Stat(source); statErr == nil {
		if err := validateRelinkStoragePath(source); err != nil {
			return err
		}
	}
	data, err := filelock.ReadFile(source)
	if os.IsNotExist(err) {
		for i := range p.result.References {
			if p.result.References[i].Type == "annotation" && p.result.References[i].OldPath == p.oldPath {
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
	ref := apicontract.AssetReference{OldPath: p.oldPath, Type: "annotation-file", Path: p.oldPath + ".sya", Reference: p.oldPath, Relinkable: true}
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
			items := p.itemsForPath(p.oldPath)
			p.files = append(p.files, &assetRelinkFile{path: source, before: data, backupOnly: true, items: items})
			p.files = append(p.files, &assetRelinkFile{path: newAbs + ".sya", after: data, items: items})
		}
	}
	p.result.References = append(p.result.References, ref)
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
