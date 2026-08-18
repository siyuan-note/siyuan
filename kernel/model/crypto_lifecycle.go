// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type NotebookCryptoState string

const (
	NotebookCryptoStateDisabled         NotebookCryptoState = "Disabled"
	NotebookCryptoStateEnabled          NotebookCryptoState = "Enabled"
	NotebookCryptoStateRecoveryRequired NotebookCryptoState = "RecoveryRequired"
)

type EncryptedBoxState string

const (
	EncryptedBoxStateLocked    EncryptedBoxState = "Locked"
	EncryptedBoxStateUnlocking EncryptedBoxState = "Unlocking"
	EncryptedBoxStateUnlocked  EncryptedBoxState = "Unlocked"
	EncryptedBoxStateLocking   EncryptedBoxState = "Locking"
	EncryptedBoxStateError     EncryptedBoxState = "Error"
)

type encryptedBoxLifecycle struct {
	transition       sync.Mutex
	lock             sync.Mutex
	condition        *sync.Cond
	state            EncryptedBoxState
	acceptOperations bool
	activeOperations int
}

func holdEncryptedBoxTransition(boxID string) func() {
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.transition.Lock()
	return lifecycle.transition.Unlock
}

var encryptedBoxLifecycles sync.Map

func getEncryptedBoxLifecycle(boxID string) *encryptedBoxLifecycle {
	created := &encryptedBoxLifecycle{state: EncryptedBoxStateLocked}
	created.condition = sync.NewCond(&created.lock)
	actual, _ := encryptedBoxLifecycles.LoadOrStore(boxID, created)
	return actual.(*encryptedBoxLifecycle)
}

func setEncryptedBoxState(boxID string, state EncryptedBoxState) {
	setEncryptedBoxStateWithAdmission(boxID, state, state == EncryptedBoxStateUnlocked)
}

// setEncryptedBoxStateWithAdmission 更新生命周期状态，并控制是否接纳新的外部请求。
func setEncryptedBoxStateWithAdmission(boxID string, state EncryptedBoxState, acceptOperations bool) {
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	lifecycle.state = state
	lifecycle.acceptOperations = acceptOperations && state == EncryptedBoxStateUnlocked
	lifecycle.condition.Broadcast()
	lifecycle.lock.Unlock()
}

func removeEncryptedBoxLifecycle(boxID string) {
	encryptedBoxLifecycles.Delete(boxID)
}

// GetEncryptedBoxState 返回加密笔记本当前的显式生命周期状态。
func GetEncryptedBoxState(boxID string) EncryptedBoxState {
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	defer lifecycle.lock.Unlock()
	return lifecycle.state
}

func repairEncryptedBoxStateFromDEK(boxID string) {
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	defer lifecycle.lock.Unlock()
	if lifecycle.state == EncryptedBoxStateLocked && IsBoxUnlocked(boxID) {
		lifecycle.state = EncryptedBoxStateUnlocked
		lifecycle.acceptOperations = true
		lifecycle.condition.Broadcast()
	}
}

// NotebookCryptoLifecycleState 返回全局加密功能状态。
func NotebookCryptoLifecycleState(hasRecoveryDependency bool) NotebookCryptoState {
	Conf.m.RLock()
	notebookCrypto := *Conf.NotebookCrypto
	Conf.m.RUnlock()
	if notebookCrypto.Enabled {
		if notebookCryptoConfigurationComplete(&notebookCrypto) {
			return NotebookCryptoStateEnabled
		}
		return NotebookCryptoStateRecoveryRequired
	}
	if hasRecoveryDependency || filelock.IsExist(dataCryptoBackupPath()) {
		return NotebookCryptoStateRecoveryRequired
	}
	return NotebookCryptoStateDisabled
}

func notebookCryptoConfigurationComplete(notebookCrypto *conf.NotebookCrypto) bool {
	if notebookCrypto == nil ||
		notebookCrypto.Spec != conf.CurrentNotebookCryptoSpec ||
		len(notebookCrypto.MasterSalt) != 16 ||
		notebookCrypto.BackupID == "" ||
		notebookCrypto.CreatedAt <= 0 ||
		notebookCrypto.Checksum == "" ||
		len(notebookCrypto.KEKMAC) != 32 {
		return false
	}
	if _, err := util.ValidateArgon2Params(notebookCrypto.KDFParams); err != nil {
		return false
	}
	nonce, err := util.EncryptionNonce(notebookCrypto.KEKVerifier)
	if err != nil || !bytes.Equal(nonce, notebookCrypto.VerifierNonce) {
		return false
	}
	return notebookCrypto.Checksum == computeBackupChecksum(notebookCrypto)
}

// AcquireEncryptedBoxOperation 为需要把明文结果保留到响应结束的操作取得准入租约。
func AcquireEncryptedBoxOperation(boxID string) error {
	if boxID == "" || !IsEncryptedBox(boxID) {
		return nil
	}
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	defer lifecycle.lock.Unlock()
	if lifecycle.state == EncryptedBoxStateLocked && IsBoxUnlocked(boxID) {
		lifecycle.state = EncryptedBoxStateUnlocked
		lifecycle.acceptOperations = true
		lifecycle.condition.Broadcast()
	}
	if lifecycle.state != EncryptedBoxStateUnlocked || !lifecycle.acceptOperations {
		return ErrEncryptedBoxNotUnlocked
	}
	lifecycle.activeOperations++
	return nil
}

// ReleaseEncryptedBoxOperation 释放响应级准入租约。
func ReleaseEncryptedBoxOperation(boxID string) {
	if boxID == "" {
		return
	}
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	if lifecycle.activeOperations > 0 {
		lifecycle.activeOperations--
	}
	lifecycle.condition.Broadcast()
	lifecycle.lock.Unlock()
}

func beginEncryptedBoxLock(boxID string) {
	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	lifecycle.state = EncryptedBoxStateLocking
	lifecycle.acceptOperations = false
	for lifecycle.activeOperations > 0 {
		lifecycle.condition.Wait()
	}
	lifecycle.lock.Unlock()
}

type encryptedBoxOperationScope struct {
	lock     sync.Mutex
	boxIDs   []string
	boxIDSet map[string]struct{}
	closed   bool
}

type encryptedBoxOperationScopeKey struct{}

var (
	// ErrEncryptedBoxNotUnlocked 表示加密笔记本当前未解锁。
	ErrEncryptedBoxNotUnlocked = errors.New("encrypted notebook is not unlocked")
	// ErrEncryptedBoxOperationScopeClosed 表示响应级操作作用域已经关闭。
	ErrEncryptedBoxOperationScopeClosed = errors.New("encrypted notebook operation scope is closed")
)

// WithEncryptedBoxOperationScope 创建覆盖整个外层响应过程的租约作用域。
func WithEncryptedBoxOperationScope(ctx context.Context) (context.Context, func()) {
	scope := &encryptedBoxOperationScope{boxIDSet: map[string]struct{}{}}
	scopedContext := context.WithValue(ctx, encryptedBoxOperationScopeKey{}, scope)
	return scopedContext, scope.release
}

// AcquireEncryptedBoxOperations 按固定顺序取得多个笔记本的响应级租约。
func AcquireEncryptedBoxOperations(ctx context.Context, boxIDs []string) (release func(), err error) {
	unique := map[string]struct{}{}
	for _, boxID := range boxIDs {
		if boxID != "" && IsEncryptedBox(boxID) {
			unique[boxID] = struct{}{}
		}
	}
	sortedBoxIDs := make([]string, 0, len(unique))
	for boxID := range unique {
		sortedBoxIDs = append(sortedBoxIDs, boxID)
	}
	sort.Strings(sortedBoxIDs)
	if len(sortedBoxIDs) == 0 {
		return func() {}, nil
	}

	if scope, ok := ctx.Value(encryptedBoxOperationScopeKey{}).(*encryptedBoxOperationScope); ok {
		err = scope.acquire(sortedBoxIDs)
		return func() {}, err
	}

	var acquired []string
	for _, boxID := range sortedBoxIDs {
		if err = AcquireEncryptedBoxOperation(boxID); err != nil {
			for i := len(acquired) - 1; i >= 0; i-- {
				ReleaseEncryptedBoxOperation(acquired[i])
			}
			return func() {}, err
		}
		acquired = append(acquired, boxID)
	}
	return func() {
		for i := len(acquired) - 1; i >= 0; i-- {
			ReleaseEncryptedBoxOperation(acquired[i])
		}
	}, nil
}

func (scope *encryptedBoxOperationScope) acquire(boxIDs []string) error {
	scope.lock.Lock()
	defer scope.lock.Unlock()
	if scope.closed {
		return ErrEncryptedBoxOperationScopeClosed
	}
	for _, boxID := range boxIDs {
		if _, exists := scope.boxIDSet[boxID]; exists {
			continue
		}
		if err := AcquireEncryptedBoxOperation(boxID); err != nil {
			return err
		}
		scope.boxIDSet[boxID] = struct{}{}
		scope.boxIDs = append(scope.boxIDs, boxID)
	}
	return nil
}

func (scope *encryptedBoxOperationScope) release() {
	scope.lock.Lock()
	if scope.closed {
		scope.lock.Unlock()
		return
	}
	scope.closed = true
	boxIDs := append([]string(nil), scope.boxIDs...)
	scope.boxIDs = nil
	scope.boxIDSet = nil
	scope.lock.Unlock()
	for i := len(boxIDs) - 1; i >= 0; i-- {
		ReleaseEncryptedBoxOperation(boxIDs[i])
	}
}
