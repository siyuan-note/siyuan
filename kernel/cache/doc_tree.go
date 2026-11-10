// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"strconv"
	"strings"
	"sync"
)

const docTreeOrderMaxBytes = 32 << 20
const docTreeOrderMaxEntries = 32
const docTreeCountMaxEntries = 4096

type docTreeCount struct {
	box, directory string
	count          int
	used           uint64
}

// DocTreeVersion 同时记录源、批量替换和引用索引版本，构建期间发生写入时不能发布旧顺序。
type DocTreeVersion struct {
	Global, Source, Refs uint64
}

// DocTreeOrder 保存直接子文档身份和版本内的计数，不保存文档正文或共享可变的响应对象。
type DocTreeOrder struct {
	key, box, revision   string
	directory            string
	title, updated, size bool
	version              DocTreeVersion
	refs                 bool
	ids                  []string
	sorts                []int
	childCounts          []int
	bytes                int
	used                 uint64
}

// DocTreeOrderScope 只声明影响该顺序的源字段，元数据展示仍由范围请求读取当前源。
type DocTreeOrderScope struct {
	Directory            string
	Title, Updated, Size bool
	Sorts                []int
	ChildCounts          []int
}

type DocTreeDocumentChange struct {
	Title, Updated, Size bool
	Structure            bool
}

func (order *DocTreeOrder) Revision() string { return order.revision }
func (order *DocTreeOrder) Len() int         { return len(order.ids) }
func (order *DocTreeOrder) Sort(index int) int {
	if len(order.sorts) == len(order.ids) {
		return order.sorts[index]
	}
	return 0
}
func (order *DocTreeOrder) IDs(offset, limit int) []string {
	return append([]string{}, order.ids[offset:min(len(order.ids), offset+limit)]...)
}
func (order *DocTreeOrder) Index(id string) int {
	for index, candidate := range order.ids {
		if candidate == id {
			return index
		}
	}
	return -1
}

// 子文档计数与目录顺序共享源和访问策略版本，结构变化后不能复用旧计数。
func (order *DocTreeOrder) ChildCount(index int) (int, bool) {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	version, stable := docTreeVersionLocked(order.box, order.refs)
	if !stable || version != order.version || index < 0 || index >= len(order.childCounts) {
		return 0, false
	}
	count := order.childCounts[index]
	return count, count >= 0
}

func (order *DocTreeOrder) SetChildCount(index, count int) {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	version, stable := docTreeVersionLocked(order.box, order.refs)
	if stable && version == order.version && index >= 0 && index < len(order.childCounts) && count >= 0 {
		order.childCounts[index] = count
	}
}

var docTreeOrders = struct {
	sync.Mutex
	global, refs, clock uint64
	refWriters          int
	writers             map[string]int
	versions            map[string]uint64
	entries             map[string]*DocTreeOrder
	counts              map[string]docTreeCount
	bytes               int
}{writers: map[string]int{}, versions: map[string]uint64{}, entries: map[string]*DocTreeOrder{}, counts: map[string]docTreeCount{}}

func docTreeVersionLocked(box string, refs bool) (DocTreeVersion, bool) {
	version := DocTreeVersion{Global: docTreeOrders.global, Source: docTreeOrders.versions[box]}
	if refs {
		version.Refs = docTreeOrders.refs
	}
	return version, docTreeOrders.writers[""] == 0 && docTreeOrders.writers[box] == 0 && (!refs || docTreeOrders.refWriters == 0)
}

func DocTreeSourceVersion(box string, refs bool) (DocTreeVersion, bool) {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	return docTreeVersionLocked(box, refs)
}

func invalidateDocTreeLocked(box string) {
	invalidateDocTreeOrdersLocked(box)
	for key, count := range docTreeOrders.counts {
		if box == "" || count.box == box {
			delete(docTreeOrders.counts, key)
		}
	}
}

func invalidateDocTreeOrdersLocked(box string) {
	if box == "" {
		docTreeOrders.global++
	} else {
		docTreeOrders.versions[box]++
	}
	for key, order := range docTreeOrders.entries {
		if box == "" || order.box == box {
			docTreeOrders.bytes -= order.bytes
			delete(docTreeOrders.entries, key)
		}
	}
}

// BeginDocTreeMutation 覆盖源写入的整个范围，包括失败后可能已经落盘的部分变更。
// 只持锁修改版本，不在文件、数据库或生命周期锁的等待过程中持有缓存锁。
func BeginDocTreeMutation(box string) func() {
	return beginDocTreeMutation(box, func() { invalidateDocTreeLocked(box) })
}

// BeginDocTreeCreation 保留其他目录的已认证计数，源写入前后都使目标目录失效。
// 仅用于写入前确认目标文件不存在的创建操作；替换、移动和删除仍走完整失效。
func BeginDocTreeCreation(box, documentPath string) func() {
	directory := path.Dir(documentPath)
	createdDirectory := strings.TrimSuffix(documentPath, ".sy")
	return beginDocTreeMutation(box, func() {
		invalidateDocTreeOrdersLocked(box)
		for key, count := range docTreeOrders.counts {
			if count.box == box && (count.directory == directory || count.directory == createdDirectory ||
				strings.HasPrefix(count.directory, createdDirectory+"/")) {
				delete(docTreeOrders.counts, key)
			}
		}
	})
}

// BeginDocTreeSortMutation 只改排序文件，目录成员及可见性未变，可以复用已认证计数。
func BeginDocTreeSortMutation() func() {
	return beginDocTreeMutation("", func() { invalidateDocTreeOrdersLocked("") })
}

func beginDocTreeMutation(box string, invalidate func()) func() {
	docTreeOrders.Lock()
	docTreeOrders.writers[box]++
	invalidate()
	docTreeOrders.Unlock()
	return func() {
		docTreeOrders.Lock()
		docTreeOrders.writers[box]--
		if docTreeOrders.writers[box] == 0 {
			delete(docTreeOrders.writers, box)
		}
		invalidate()
		docTreeOrders.Unlock()
	}
}

func advanceDocTreeDocumentLocked(box, documentPath string, change DocTreeDocumentChange) {
	if change.Structure {
		for key, count := range docTreeOrders.counts {
			if count.box == box {
				delete(docTreeOrders.counts, key)
			}
		}
	}
	docTreeOrders.versions[box]++
	version := docTreeOrders.versions[box]
	for key, order := range docTreeOrders.entries {
		if order.box != box {
			continue
		}
		if change.Structure || order.directory == "" || order.directory == path.Dir(documentPath) &&
			(change.Title && order.title || change.Updated && order.updated || change.Size && order.size) {
			docTreeOrders.bytes -= order.bytes
			delete(docTreeOrders.entries, key)
		} else {
			// 验证版本只在缓存锁内读取和更新；保留的不可变顺序及公开 revision 不变。
			order.version.Source = version
		}
	}
}

// BeginDocTreeDocumentMutation 的字段差异必须来自本次写入已认证的旧源，不能来自异步属性缓存。
func BeginDocTreeDocumentMutation(box, documentPath string, change DocTreeDocumentChange) func() {
	docTreeOrders.Lock()
	docTreeOrders.writers[box]++
	advanceDocTreeDocumentLocked(box, documentPath, change)
	docTreeOrders.Unlock()
	return func() {
		docTreeOrders.Lock()
		docTreeOrders.writers[box]--
		if docTreeOrders.writers[box] == 0 {
			delete(docTreeOrders.writers, box)
		}
		advanceDocTreeDocumentLocked(box, documentPath, change)
		docTreeOrders.Unlock()
	}
}

func InvalidateDocTree(box string) {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	invalidateDocTreeLocked(box)
}

// 引用可能跨笔记本，只淘汰依赖引用数排序的快照。
func InvalidateDocTreeRefs() {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	docTreeOrders.refs++
	for key, order := range docTreeOrders.entries {
		if order.refs {
			docTreeOrders.bytes -= order.bytes
			delete(docTreeOrders.entries, key)
		}
	}
}

func BeginDocTreeRefMutation() func() {
	docTreeOrders.Lock()
	docTreeOrders.refWriters++
	docTreeOrders.refs++
	docTreeOrders.Unlock()
	return func() {
		docTreeOrders.Lock()
		docTreeOrders.refWriters--
		docTreeOrders.Unlock()
		InvalidateDocTreeRefs()
	}
}

func GetDocTreeOrder(key, box string, refs bool) *DocTreeOrder {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	version, stable := docTreeVersionLocked(box, refs)
	order := docTreeOrders.entries[key]
	if !stable || order == nil || order.version != version {
		return nil
	}
	docTreeOrders.clock++
	order.used = docTreeOrders.clock
	return order
}

func DocTreeOrderCurrent(order *DocTreeOrder) bool {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	version, stable := docTreeVersionLocked(order.box, order.refs)
	return stable && version == order.version
}

// 计数按查询访问策略及目录缓存，排序快照重建不必重新读取未改变的子文档源。
func GetDocTreeChildCount(key, box, directory string) (int, bool) {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	if _, stable := docTreeVersionLocked(box, true); !stable {
		return 0, false
	}
	cacheKey := key + "\x00" + directory
	count, ok := docTreeOrders.counts[cacheKey]
	if !ok || count.box != box {
		return 0, false
	}
	docTreeOrders.clock++
	count.used = docTreeOrders.clock
	docTreeOrders.counts[cacheKey] = count
	return count.count, true
}

func PutDocTreeChildCount(key, box, directory string, version DocTreeVersion, count int) {
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	current, stable := docTreeVersionLocked(box, true)
	if !stable || current != version || count < 0 {
		return
	}
	cacheKey := key + "\x00" + directory
	if _, exists := docTreeOrders.counts[cacheKey]; !exists && len(docTreeOrders.counts) >= docTreeCountMaxEntries {
		var oldestKey string
		var oldest uint64 = ^uint64(0)
		for candidate, entry := range docTreeOrders.counts {
			if entry.used < oldest {
				oldestKey, oldest = candidate, entry.used
			}
		}
		delete(docTreeOrders.counts, oldestKey)
	}
	docTreeOrders.clock++
	docTreeOrders.counts[cacheKey] = docTreeCount{box: strings.Clone(box), directory: strings.Clone(directory),
		count: count, used: docTreeOrders.clock}
}

// PutDocTreeOrder 限制条目和内存总量，旧构建不能在失效后写回。
func PutDocTreeOrder(key, box string, refs bool, version DocTreeVersion, ids []string, scopes ...DocTreeOrderScope) (*DocTreeOrder, bool) {
	cost := 256 + len(key) + len(box) + len(ids)*(strconv.IntSize/8)
	var scope DocTreeOrderScope
	if len(scopes) > 0 {
		scope = scopes[0]
		cost += len(scope.Directory) + len(scope.Sorts)*(strconv.IntSize/8)
	}
	for _, id := range ids {
		cost += 40 + len(id)
	}
	digest := sha256.New()
	fmt.Fprintf(digest, "%s\x00%d/%d/%d\x00", key, version.Global, version.Source, version.Refs)
	for _, id := range ids {
		digest.Write([]byte(id))
		digest.Write([]byte{0})
	}
	order := &DocTreeOrder{key: strings.Clone(key), box: strings.Clone(box), refs: refs, version: version,
		revision: hex.EncodeToString(digest.Sum(nil)), bytes: cost, ids: append([]string{}, ids...),
		directory: strings.Clone(scope.Directory), title: scope.Title, updated: scope.Updated, size: scope.Size,
		sorts: append([]int{}, scope.Sorts...), childCounts: make([]int, len(ids))}
	for index := range order.childCounts {
		order.childCounts[index] = -1
	}
	if len(scope.ChildCounts) == len(ids) {
		copy(order.childCounts, scope.ChildCounts)
	}
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	current, stable := docTreeVersionLocked(box, refs)
	if !stable || version != current {
		return nil, false
	}
	// 单个目录超出缓存预算时仍可以分批读取；相同源版本重建得到相同摘要，不会循环失效。
	if cost > docTreeOrderMaxBytes {
		return order, true
	}
	if previous := docTreeOrders.entries[key]; previous != nil {
		docTreeOrders.bytes -= previous.bytes
		delete(docTreeOrders.entries, key)
	}
	for len(docTreeOrders.entries) >= docTreeOrderMaxEntries || docTreeOrders.bytes+cost > docTreeOrderMaxBytes {
		var oldest *DocTreeOrder
		for _, entry := range docTreeOrders.entries {
			if oldest == nil || entry.used < oldest.used {
				oldest = entry
			}
		}
		delete(docTreeOrders.entries, oldest.key)
		docTreeOrders.bytes -= oldest.bytes
	}
	docTreeOrders.clock++
	order.used = docTreeOrders.clock
	docTreeOrders.entries[key] = order
	docTreeOrders.bytes += cost
	return order, true
}
