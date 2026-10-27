// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"strings"

	"github.com/siyuan-note/dejavu"
)

// Incomplete password changes retain recovery material locally. Do not publish
// their intermediate key files as a completed manual snapshot or upload.
func checkRepositoryPasswordMigration() error {
	if _, err := os.Stat(masterPasswordMigrationPath()); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	return errMasterPasswordMigrationPending
}

func preparePasswordRecoveryDownload(repo *dejavu.Repo) (bool, error) {
	if err := checkRepositoryPasswordMigration(); err != nil && !errors.Is(err, errMasterPasswordMigrationPending) {
		return false, err
	}
	migration, err := readMasterPasswordMigration()
	if err != nil || migration == nil {
		return false, err
	}
	// Keep the local manifest outside this download's comparison index so a
	// complete remote snapshot without it cannot delete the recovery instructions.
	// The existing local safety checkpoint before download remains available.
	repo.IgnoreLines = append(append([]string(nil), repo.IgnoreLines...), "/.siyuan/master-password-migration.json")
	return true, nil
}

func checkPasswordMigrationCheckout(plan *dejavu.CheckoutPlan) error {
	err := checkRepositoryPasswordMigration()
	if err == nil {
		return nil
	}
	if !errors.Is(err, errMasterPasswordMigrationPending) {
		return err
	}
	for _, file := range plan.Upserts {
		if strings.EqualFold(file.Path, "/.siyuan/master-password-migration.json") {
			return err
		}
	}
	for _, file := range plan.Removes {
		if strings.EqualFold(file.Path, "/.siyuan/master-password-migration.json") {
			return err
		}
	}
	return nil
}
