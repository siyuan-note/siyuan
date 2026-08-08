// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import (
	"errors"
	"sync"
)

// Locks are shared in-process by normalized storage root and never retired, so
// detached CRUD from an old generation and a new startup use the same lock.
// This lock coordinates only SiYuan operations; physical path isolation from
// external concurrent moves of open directories is out of scope.
var storageTreeLocks sync.Map

func storageTreeLock(storageDir string) (*sync.RWMutex, error) {
	key, err := normalizeStorageRootLockKey(storageDir)
	if err != nil {
		return nil, err
	}
	lock, _ := storageTreeLocks.LoadOrStore(key, &sync.RWMutex{})
	return lock.(*sync.RWMutex), nil
}

func (p *KernelPlugin) storageTreeLock() (*sync.RWMutex, error) {
	if p == nil {
		return nil, errors.New("siyuan.storage: storage root is unavailable")
	}
	return storageTreeLock(p.storageDir)
}
