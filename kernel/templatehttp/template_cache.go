// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package templatehttp

import (
	"container/list"
	"crypto/sha256"
	"io"
	"sync"
)

const maxCachedTemplates = 1024
const maxCachedTemplateBytes = 16 << 20

var templateResults = struct {
	sync.Mutex
	generation uint64
	bytes      int
	entries    map[[32]byte]*list.Element
	order      list.List
}{entries: make(map[[32]byte]*list.Element)}

type cachedTemplateResult struct {
	key     [32]byte
	content string
	inputs  string
}

type pendingTemplateResult struct {
	scope, inputs, content string
}

func templateCacheGeneration() uint64 {
	templateResults.Lock()
	defer templateResults.Unlock()
	return templateResults.generation
}

// ClearTemplateResults 清除字段结果，并阻止清理前开始的执行重新写入；锁定笔记本和撤销许可共用此边界。
func ClearTemplateResults() {
	templateResults.Lock()
	defer templateResults.Unlock()
	templateResults.generation++
	templateResults.bytes = 0
	clear(templateResults.entries)
	templateResults.order.Init()
}

func getTemplateResult(key [32]byte, generation uint64, inputs string) (string, bool) {
	templateResults.Lock()
	defer templateResults.Unlock()
	if generation != templateResults.generation {
		return "", false
	}
	entry := templateResults.entries[key]
	if entry == nil {
		return "", false
	}
	if entry.Value.(cachedTemplateResult).inputs != inputs {
		templateResults.bytes -= len(entry.Value.(cachedTemplateResult).content)
		delete(templateResults.entries, key)
		templateResults.order.Remove(entry)
		return "", false
	}
	templateResults.order.MoveToFront(entry)
	return entry.Value.(cachedTemplateResult).content, true
}

func setTemplateResultLocked(key [32]byte, inputs, content string) {
	if old := templateResults.entries[key]; old != nil {
		templateResults.bytes -= len(old.Value.(cachedTemplateResult).content)
		templateResults.order.Remove(old)
	}
	templateResults.entries[key] = templateResults.order.PushFront(cachedTemplateResult{key: key, content: content, inputs: inputs})
	templateResults.bytes += len(content)
	for len(templateResults.entries) > maxCachedTemplates || templateResults.bytes > maxCachedTemplateBytes {
		old := templateResults.order.Back()
		cached := old.Value.(cachedTemplateResult)
		templateResults.bytes -= len(cached.content)
		delete(templateResults.entries, cached.key)
		templateResults.order.Remove(old)
	}
}

// CachedTemplate 仅对自动更新读取同行、同来源、同输入的成功结果，仍计入输出预算并检查访问边界。
func (e *Execution) CachedTemplate(scope, identity, inputs string) (string, bool) {
	if !e.checkRequestGuard(scope) {
		return "", false
	}
	e.mu.Lock()
	denied := e.deniedScopes[scope]
	automatic := e.automaticRefresh
	e.mu.Unlock()
	if denied {
		return "", false
	}
	key := sha256.Sum256([]byte(identity))
	inputHash := sha256.Sum256([]byte(scope + "\x00" + inputs))
	inputs = string(inputHash[:])
	if !automatic {
		removeTemplateResult(key, e.templateGeneration)
		return "", false
	}
	content, found := getTemplateResult(key, e.templateGeneration, inputs)
	if !found || !e.checkRequestGuard(scope) {
		return "", false
	}
	if _, err := io.WriteString(e.Writer(io.Discard), content); err != nil {
		return "", false
	}
	return content, true
}

// SetPreserveHTTPResults 仅供排序等展示操作复用外部依赖模板的当前快照。
func (e *Execution) SetPreserveHTTPResults(preserve bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.preserveHTTPResults = preserve
}

func (e *Execution) PreserveHTTPResults() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.automaticRefresh && e.preserveHTTPResults
}

func (e *Execution) StoreTemplate(scope, identity, inputs, content string) {
	e.mu.Lock()
	failed := e.approvalsFailed
	e.mu.Unlock()
	if failed || len(content) > maxOutput || !e.checkRequestGuard(scope) {
		return
	}
	key := sha256.Sum256([]byte(identity))
	inputHash := sha256.Sum256([]byte(scope + "\x00" + inputs))
	inputs = string(inputHash[:])
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.Err() != nil || e.approvalsFailed {
		return
	}
	old, exists := e.pendingTemplates[key]
	if !exists && len(e.pendingTemplates) >= maxCachedTemplates {
		return
	}
	bytes := e.pendingTemplateBytes - len(old.content) + len(content)
	if bytes > maxCachedTemplateBytes {
		return
	}
	if e.pendingTemplates == nil {
		e.pendingTemplates = make(map[[32]byte]pendingTemplateResult)
	}
	e.pendingTemplates[key] = pendingTemplateResult{scope: scope, inputs: inputs, content: content}
	e.pendingTemplateBytes = bytes
}

// CommitTemplateResults 仅在整个请求成功后接纳结果；取消、错误和失效来源的中间结果不会跨请求复用。
func (e *Execution) CommitTemplateResults() {
	e.mu.Lock()
	pending := e.pendingTemplates
	e.pendingTemplates = nil
	e.pendingTemplateBytes = 0
	failed := e.approvalsFailed
	e.mu.Unlock()
	if failed || e.Err() != nil {
		return
	}
	scopes := make(map[string]bool)
	for _, value := range pending {
		if !scopes[value.scope] && !e.checkRequestGuard(value.scope) {
			return
		}
		scopes[value.scope] = true
	}
	templateResults.Lock()
	defer templateResults.Unlock()
	if e.Err() != nil || e.templateGeneration != templateResults.generation {
		return
	}
	for key, value := range pending {
		setTemplateResultLocked(key, value.inputs, value.content)
	}
}

func removeTemplateResult(key [32]byte, generation uint64) {
	templateResults.Lock()
	defer templateResults.Unlock()
	if generation != templateResults.generation {
		return
	}
	if entry := templateResults.entries[key]; entry != nil {
		templateResults.bytes -= len(entry.Value.(cachedTemplateResult).content)
		delete(templateResults.entries, key)
		templateResults.order.Remove(entry)
	}
}
