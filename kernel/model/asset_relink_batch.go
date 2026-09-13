// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/ClarkThan/ahocorasick"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetRelinkItem struct {
	input      apicontract.AssetRelinkMapping
	rule       *assetRelinker
	reason     string
	inputError bool
	updated    int
}

type assetRelinkStamp struct {
	exists   bool
	size     int64
	modified time.Time
	mode     os.FileMode
}

func FindAssetReferencesWithContext(ctx context.Context, path string) (apicontract.AssetReferencesData, error) {
	return runAssetRelinks(ctx, []apicontract.AssetRelinkMapping{{OldPath: path}}, true, true, false)
}

func RelinkAssetWithContext(ctx context.Context, oldPath, newPath string, dryRun bool) (apicontract.AssetReferencesData, error) {
	return runAssetRelinks(ctx, []apicontract.AssetRelinkMapping{{OldPath: oldPath, NewPath: newPath}}, dryRun, false, false)
}

func FindAssetReferencesBatch(ctx context.Context, paths []string) (apicontract.AssetReferencesData, error) {
	mappings := make([]apicontract.AssetRelinkMapping, len(paths))
	for i, path := range paths {
		mappings[i].OldPath = path
	}
	return runAssetRelinks(ctx, mappings, true, true, true)
}

func RelinkAssets(ctx context.Context, mappings []apicontract.AssetRelinkMapping, dryRun bool) (apicontract.AssetReferencesData, error) {
	return runAssetRelinks(ctx, mappings, dryRun, false, true)
}

func newAssetRelinkPlan(ctx context.Context, mappings []apicontract.AssetRelinkMapping, dryRun, lookup, batch bool) (*assetRelinkPlan, error) {
	p := &assetRelinkPlan{ctx: ctx, batch: batch, lookup: lookup, assetRelinker: &assetRelinker{
		collectOnly: true, routes: map[string]*assetRelinker{},
		result: apicontract.AssetReferencesData{References: []apicontract.AssetReference{}, SkippedNotebooks: []string{}, DryRun: dryRun},
	}}
	if len(mappings) == 0 {
		return p, errors.New("at least one asset path or mapping is required")
	}
	seen := map[string]bool{}
	var validationErr error
	for _, mapping := range mappings {
		rule, err := newAssetRelinker(mapping.OldPath, mapping.NewPath)
		if !lookup && mapping.NewPath == "" {
			err = errors.New("newPath is required")
		}
		item := &assetRelinkItem{input: mapping, rule: rule}
		p.items = append(p.items, item)
		if rule.oldPath != "" {
			if seen[rule.oldPath] {
				validationErr = fmt.Errorf("duplicate oldPath: %s", mapping.OldPath)
			}
			seen[rule.oldPath] = true
		}
		if err != nil {
			item.inputError = true
			p.fail(item, err.Error())
			continue
		}
		p.routes[rule.oldPath] = rule
	}
	if validationErr != nil {
		return p, validationErr
	}
	for _, item := range p.items {
		if item.reason == "" && item.rule.newPath != item.rule.oldPath && seen[item.rule.newPath] {
			return p, errors.New("chained or cyclic asset mappings are not supported")
		}
	}
	return p, nil
}

func runAssetRelinks(ctx context.Context, mappings []apicontract.AssetRelinkMapping, dryRun, lookup, batch bool) (apicontract.AssetReferencesData, error) {
	p, err := newAssetRelinkPlan(ctx, mappings, dryRun, lookup, batch)
	if err != nil {
		p.failAll(err)
		return p.response(err)
	}
	var lastProgress time.Time
	p.progress = func(path string) {
		if Conf != nil && time.Since(lastProgress) >= 250*time.Millisecond {
			lastProgress = time.Now()
			language := 70
			if p.saving {
				language = 111
			}
			util.PushEndlessProgress(fmt.Sprintf(Conf.Language(language), filepath.Base(path)))
		}
	}
	defer util.PushClearProgress()
	err = p.run()
	if err != nil {
		p.failAll(err)
	}
	return p.response(err)
}

func lockAssetRelink(ctx context.Context, lock *sync.Mutex) error {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if lock.TryLock() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (p *assetRelinkPlan) run() error {
	p.initialize()
	if len(p.routes) == 0 {
		return nil
	}
	if err := lockAssetRelink(p.ctx, &syncLock); err != nil {
		return err
	}
	defer syncLock.Unlock()
	for txQueueSize() > 0 || isFlushing.Load() {
		select {
		case <-p.ctx.Done():
			return p.ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	// 扫描期间允许编辑；保存前在事务锁内校验文件与目录快照，新增引用也会触发重试。
	if err := p.scan(); err != nil {
		return err
	}
	p.finishPreflight()
	if p.result.DryRun || p.lookup {
		return nil
	}
	if err := lockAssetRelink(p.ctx, &flushLock); err != nil {
		return err
	}
	defer flushLock.Unlock()
	if txQueueSize() > 0 {
		return errors.New("pending edits during asset scan; retry the request")
	}
	return p.apply()
}

func (p *assetRelinkPlan) initialize() {
	if p.ctx == nil {
		p.ctx = context.Background()
	}
	if p.inventory == nil {
		p.inventory = map[string]assetRelinkStamp{}
	}
	if p.items == nil {
		rule := p.assetRelinker
		p.items = []*assetRelinkItem{{input: apicontract.AssetRelinkMapping{OldPath: rule.oldPath, NewPath: rule.newPath}, rule: rule}}
		p.assetRelinker = &assetRelinker{routes: map[string]*assetRelinker{rule.oldPath: rule}, collectOnly: true, result: rule.result}
	}
	if p.matcher == nil {
		patterns := []string{}
		p.itemByPath = map[string]*assetRelinkItem{}
		for _, item := range p.items {
			if p.routes[item.rule.oldPath] != item.rule {
				continue
			}
			p.itemByPath[item.rule.oldPath] = item
			patterns = append(patterns, filepath.Base(item.rule.oldPath))
		}
		p.matcher = ahocorasick.NewMatcher()
		p.matcher.BuildWithPatterns(patterns)
	}
}

func (p *assetRelinkPlan) checkContext() error { return p.ctx.Err() }
func (p *assetRelinkPlan) reportProgress(path string) {
	if p.progress != nil {
		p.progress(path)
	}
}

func (p *assetRelinkPlan) observe(path string) error {
	if _, ok := p.inventory[path]; ok {
		return nil
	}
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		p.inventory[path] = assetRelinkStamp{}
		return nil
	}
	if err != nil {
		return err
	}
	p.inventory[path] = assetRelinkStamp{true, info.Size(), info.ModTime(), info.Mode()}
	return nil
}

func (p *assetRelinkPlan) validateSnapshot() error {
	for path, stamp := range p.inventory {
		if err := p.checkContext(); err != nil {
			return err
		}
		info, err := os.Stat(path)
		if !stamp.exists && os.IsNotExist(err) {
			continue
		}
		if err != nil || !stamp.exists || stamp.size != info.Size() || !stamp.modified.Equal(info.ModTime()) || stamp.mode != info.Mode() {
			return fmt.Errorf("workspace changed during asset scan; retry the request: %s", path)
		}
	}
	return nil
}

// mayContainReferences 仅排除没有目标文件名且没有任何转义的源；转义一律进入语义解析以防漏筛。
func (p *assetRelinkPlan) mayContainReferences(data []byte) bool {
	if bytes.ContainsAny(data, "\\%&") {
		return true
	}
	return len(p.matcher.SearchIndexed(string(data))) > 0
}

func (p *assetRelinkPlan) itemsForPath(path string) map[*assetRelinkItem]bool {
	ret := map[*assetRelinkItem]bool{}
	if item := p.itemByPath[path]; item != nil {
		ret[item] = true
	}
	return ret
}

func (p *assetRelinkPlan) referenceItems(start int) map[*assetRelinkItem]bool {
	ret := map[*assetRelinkItem]bool{}
	for _, ref := range p.result.References[start:] {
		for item := range p.itemsForPath(ref.OldPath) {
			ret[item] = true
		}
	}
	return ret
}

func (p *assetRelinkPlan) fail(item *assetRelinkItem, reason string) {
	if item.reason == "" {
		item.reason = reason
	}
	item.rule.disabled = true
}

func (p *assetRelinkPlan) failAll(err error) {
	for _, item := range p.items {
		p.fail(item, err.Error())
	}
}

func (p *assetRelinkPlan) scanMetadata(roots []string) error {
	ocrMappings := make([]util.AssetTextRelinkMapping, len(p.items))
	for i, item := range p.items {
		if err := p.checkContext(); err != nil {
			return err
		}
		if item.reason != "" {
			continue
		}
		rule := item.rule
		oldAbs, err := resolveRelinkAsset(roots, rule.oldPath, false)
		newAbs := ""
		if err == nil && rule.newPath != "" {
			newAbs, err = resolveRelinkAsset(roots, rule.newPath, true)
		}
		if err != nil {
			item.inputError = true
			p.fail(item, err.Error())
			continue
		}
		for _, abs := range []string{oldAbs, newAbs} {
			if abs != "" {
				if err = p.observe(abs); err != nil {
					return err
				}
			}
		}
		p.oldPath, p.newPath = rule.oldPath, rule.newPath
		if err = p.scanAnnotation(oldAbs, newAbs); err != nil {
			p.fail(item, err.Error())
		}
		if item.reason == "" {
			ocrMappings[i] = util.AssetTextRelinkMapping{OldPath: rule.oldPath, NewPath: rule.newPath}
		}
	}
	p.oldPath, p.newPath = "", ""
	var err error
	p.ocrPlan, err = util.PrepareAssetTextRelinks(ocrMappings)
	if err != nil {
		return err
	}
	for i, result := range p.ocrPlan.Results {
		if !result.Exists && result.Reason == "" {
			continue
		}
		item := p.items[i]
		p.result.References = append(p.result.References, apicontract.AssetReference{OldPath: item.rule.oldPath,
			Type: "ocr", Path: "assets/ocr-texts.json", Reference: item.rule.oldPath, Replacement: item.rule.newPath,
			Relinkable: result.Reason == "", Reason: result.Reason})
	}
	return nil
}

func (p *assetRelinkPlan) finishPreflight() {
	for _, ref := range p.result.References {
		if !ref.Relinkable {
			for item := range p.itemsForPath(ref.OldPath) {
				p.fail(item, ref.Reason)
			}
		}
	}
	// 同一个标注目标只创建一次，冲突时拒绝所有相关映射。
	targets := map[string]*assetRelinkFile{}
	files := make([]*assetRelinkFile, 0, len(p.files))
	for _, file := range p.files {
		if file.before == nil {
			if prior := targets[file.path]; prior != nil {
				for item := range file.items {
					prior.items[item] = true
				}
				if prior.conflict || !bytes.Equal(prior.after, file.after) {
					prior.conflict = true
					for item := range prior.items {
						p.fail(item, "annotation_target_conflict")
					}
				}
				continue
			}
			targets[file.path] = file
		}
		files = append(files, file)
	}
	p.files = files
}

func activeRelinkItems(items map[*assetRelinkItem]bool) map[*assetRelinkItem]bool {
	ret := map[*assetRelinkItem]bool{}
	for item := range items {
		if item.reason == "" && item.rule.oldPath != item.rule.newPath && item.rule.newPath != "" {
			ret[item] = true
		}
	}
	return ret
}

func (p *assetRelinkPlan) response(fatal error) (apicontract.AssetReferencesData, error) {
	p.result.Items = nil
	ok := 0
	grouped := map[string][]apicontract.AssetReference{}
	for _, reference := range p.result.References {
		grouped[reference.OldPath] = append(grouped[reference.OldPath], reference)
	}
	for _, item := range p.items {
		refs := []apicontract.AssetReference{}
		refs = append(refs, grouped[item.rule.oldPath]...)
		result := apicontract.AssetRelinkItemResult{OldPath: item.input.OldPath, NewPath: item.input.NewPath,
			OK: item.reason == "", Reason: item.reason, References: refs, Updated: item.updated}
		if result.OK {
			ok++
		}
		if p.batch {
			p.result.Items = append(p.result.Items, result)
		}
	}
	if fatal != nil {
		return p.result, fatal
	}
	if !p.batch && len(p.items) == 1 {
		item := p.items[0]
		if item.reason != "" && (item.inputError || (!p.result.DryRun && !p.lookup)) {
			return p.result, errors.New(item.reason)
		}
		return p.result, nil
	}
	if ok == 0 {
		return p.result, errors.New("all asset mappings failed")
	}
	return p.result, nil
}

func (p *assetRelinkPlan) apply() (err error) {
	p.finishPreflight()
	if err = p.validateSnapshot(); err != nil {
		return err
	}
	var files []*assetRelinkFile
	for _, file := range p.files {
		if len(activeRelinkItems(file.items)) > 0 {
			files = append(files, file)
		}
	}
	var ocrSelected []int
	if p.ocrPlan != nil {
		for i, result := range p.ocrPlan.Results {
			if result.Changed && p.items[i].reason == "" {
				ocrSelected = append(ocrSelected, i)
			}
		}
	}
	if len(files) == 0 && len(ocrSelected) == 0 {
		return nil
	}
	if err = p.checkContext(); err != nil {
		return err
	}
	historyDir, err := newAssetRelinkHistoryDir()
	if err != nil {
		return err
	}
	p.result.HistoryPath = filepath.ToSlash(historyDir)
	// 所有候选源先备份；备份失败属于请求级错误，此时尚未修改任何引用。
	for _, file := range files {
		if err = p.checkContext(); err != nil {
			return err
		}
		if file.before == nil {
			continue
		}
		current, readErr := filelock.ReadFile(file.path)
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
	changedViews, reload := map[string]bool{}, map[string]bool{}
	defer func() {
		for _, tree := range p.trees {
			viewChanged := false
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.Type == ast.NodeAttributeView && changedViews[n.AttributeViewID] {
					viewChanged = true
				}
				return ast.WalkContinue
			})
			if viewChanged {
				reload[tree.Root.ID] = true
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
	count := func(items map[*assetRelinkItem]bool) {
		p.result.Updated++
		for item := range items {
			item.updated++
		}
	}
	failed := func(items map[*assetRelinkItem]bool, writeErr error) {
		for item := range items {
			p.fail(item, writeErr.Error())
		}
	}
	// 先准备附属数据；失败项在后续共享文档中保留原引用。
	p.saving = true
	for _, file := range files {
		if file.before != nil {
			continue
		}
		if err = p.checkContext(); err != nil {
			return err
		}
		items := activeRelinkItems(file.items)
		if len(items) == 0 {
			continue
		}
		p.reportProgress(file.path)
		if writeErr := util.WriteFileIfUnchanged(file.path, nil, file.after); writeErr != nil {
			failed(items, writeErr)
		} else {
			count(items)
		}
	}
	if len(ocrSelected) > 0 {
		if err = p.checkContext(); err != nil {
			return err
		}
		selected := ocrSelected[:0]
		for _, i := range ocrSelected {
			if p.items[i].reason == "" {
				selected = append(selected, i)
			}
		}
		changed, writeErr := p.ocrPlan.Save(historyDir, selected)
		if writeErr != nil {
			for _, i := range selected {
				p.fail(p.items[i], writeErr.Error())
			}
		} else if len(changed) > 0 {
			items := map[*assetRelinkItem]bool{}
			for _, i := range changed {
				items[p.items[i]] = true
			}
			count(items)
		}
	}
	p.collectOnly, p.recordless = false, true
	for _, file := range files {
		if file.backupOnly || file.before == nil {
			continue
		}
		if err = p.checkContext(); err != nil {
			return err
		}
		items := activeRelinkItems(file.items)
		if len(items) == 0 {
			continue
		}
		p.reportProgress(file.path)
		var writeErr error
		before := p.changes
		if file.tree != nil {
			p.tree(file.tree, apicontract.AssetReference{})
			if p.changes == before {
				continue
			}
			var size uint64
			size, writeErr = filesys.WriteTreeIfUnchanged(file.tree, file.before)
			if writeErr == nil {
				sql.UpsertTreeQueue(file.tree)
				refreshDocInfoWithSize(file.tree, size)
				reload[file.tree.Root.ID] = true
			}
		} else if file.view != nil {
			writeErr = p.attributeView(file.view, apicontract.AssetReference{})
			if writeErr == nil && p.changes == before {
				continue
			}
			if writeErr == nil {
				writeErr = av.SaveAttributeViewIfUnchanged(file.view, file.before)
			}
			if writeErr == nil {
				changedViews[file.view.ID] = true
			}
		}
		if writeErr != nil {
			failed(items, writeErr)
		} else {
			count(items)
		}
	}
	return nil
}
