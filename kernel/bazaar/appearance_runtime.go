// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

var ErrAppearancePackageDeleted = errors.New("appearance package is deleted")

// ValidateAppearancePackageForUse 允许编辑已安装包，仅校验状态格式和删除标记，不重写同步摘要。
func ValidateAppearancePackageForUse(kind, name string) error {
	_, statePath, err := appearancePackagePaths(kind, name)
	if err != nil {
		return err
	}
	state, err := readAppearanceState(statePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if state.Deleted {
		return fmt.Errorf("%w: %s/%s", ErrAppearancePackageDeleted, kind, name)
	}
	return nil
}

// PendingAppearancePackages 在调用方持有外观锁时读取本机安装事务，不执行恢复或修改文件。
func PendingAppearancePackages() ([]string, error) {
	entries, err := os.ReadDir(appearanceOperationsPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	keys := map[string]bool{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(appearanceOperationsPath(), entry.Name(), "operation.json"))
		if os.IsNotExist(readErr) {
			continue
		}
		if readErr != nil {
			return nil, readErr
		}
		var operation appearanceOperation
		if readErr = json.Unmarshal(data, &operation); readErr != nil || operation.Version != 1 {
			return nil, fmt.Errorf("invalid pending appearance operation: %s", entry.Name())
		}
		if err = validateAppearanceState(&operation.State); err != nil {
			return nil, err
		}
		if _, _, err = appearancePackagePaths(operation.Kind, operation.Name); err != nil {
			return nil, err
		}
		keys["/"+operation.Kind+"/"+operation.Name] = true
	}
	ret := make([]string, 0, len(keys))
	for key := range keys {
		ret = append(ret, key)
	}
	sort.Strings(ret)
	return ret, nil
}
