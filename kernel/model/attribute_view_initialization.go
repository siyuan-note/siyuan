// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type attributeViewInitializationLock struct {
	mutex sync.Mutex
	users int
}

var attributeViewInitializationLocks = struct {
	sync.Mutex
	entries map[string]*attributeViewInitializationLock
}{entries: map[string]*attributeViewInitializationLock{}}

// lockAttributeViewInitialization 按数据库 ID 协调首次创建，并在所有等待者退出后回收锁。
// pending 归属映射也以数据库 ID 为键，因此不同加密边界的同 ID 创建必须一起协调。
func lockAttributeViewInitialization(avID string) func() {
	attributeViewInitializationLocks.Lock()
	entry := attributeViewInitializationLocks.entries[avID]
	if nil == entry {
		entry = &attributeViewInitializationLock{}
		attributeViewInitializationLocks.entries[avID] = entry
	}
	entry.users++
	attributeViewInitializationLocks.Unlock()
	entry.mutex.Lock()
	return func() {
		entry.mutex.Unlock()
		attributeViewInitializationLocks.Lock()
		entry.users--
		if entry.users == 0 {
			delete(attributeViewInitializationLocks.entries, avID)
		}
		attributeViewInitializationLocks.Unlock()
	}
}

// attributeViewRenderPath 在载体的加密边界内查找定义，无载体的兼容调用保留全局回退。
func attributeViewRenderPath(avID, boxID string, exactBox bool) (string, error) {
	var existing string
	if exactBox {
		existing, _ = av.FindAttributeViewPathInBox(avID, boxID)
	} else {
		existing, _ = av.FindAttributeViewPath(avID)
	}
	if existing != "" {
		return existing, nil
	}
	if exactBox {
		if foreignPath, foreignBoxID := av.FindAttributeViewPath(avID); foreignPath != "" && foreignBoxID != boxID {
			return "", av.ErrAttributeViewNotFound
		}
	}
	if boxID != "" {
		return filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json"), nil
	}
	return av.GetAttributeViewDataPath(avID), nil
}

func initializeAttributeViewForRender(blockID, avID, boxID string, exactBox bool, layout av.LayoutType) (*av.AttributeView, error) {
	unlock := lockAttributeViewInitialization(avID)
	defer unlock()
	// 等待其他创建者后重新检查定义及其边界，避免覆盖已生成的视图和字段 ID。
	path, err := attributeViewRenderPath(avID, boxID, exactBox)
	if nil != err {
		return nil, err
	}
	// 解析也可能设置 pending 归属；在交还锁之前统一清理，避免失败请求清掉后续创建者的映射。
	defer av.SetAVBoxID(avID, "")
	if !filelock.IsExist(path) {
		if boxID != "" {
			av.SetAVBoxID(avID, boxID)
		}
		if err = av.SaveAttributeView(newAttributeViewWithLayout(avID, layout)); nil != err {
			return nil, err
		}
		if blockID != "" {
			av.UpsertBlockRel(avID, blockID)
		}
	}
	// 每个调用者单独解析，实际渲染不持有初始化锁，也不共享可变的数据库对象。
	if exactBox {
		return av.ParseAttributeViewInBox(avID, boxID)
	}
	return av.ParseAttributeView(avID)
}
