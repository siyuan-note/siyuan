// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// CheckEncryptedIndexCompatibility 将索引版本保存在受 SQLCipher 认证的表中，拒绝复用缺少版本或参数不匹配的旧索引。
// schema 由各索引维护，修改表结构时递增；索引重建由已认证源文档的调用方负责。
func CheckEncryptedIndexCompatibility(db *sql.DB, kind string, schema int) error {
	settings := map[string]string{}
	for _, name := range []string{"cipher_version", "cipher_page_size", "kdf_iter", "cipher_hmac_algorithm", "cipher_kdf_algorithm", "cipher_use_hmac"} {
		var value string
		if err := db.QueryRow("PRAGMA " + name).Scan(&value); err != nil {
			return fmt.Errorf("read encrypted index setting %s: %w", name, err)
		}
		if value == "" {
			return fmt.Errorf("missing encrypted index setting %s", name)
		}
		settings[name] = value
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	var metadataTables int
	if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'encrypted_index_meta'").Scan(&metadataTables); err != nil {
		return err
	}
	if metadataTables == 0 {
		var tables int
		if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table'").Scan(&tables); err != nil {
			return err
		}
		if tables != 0 {
			return errors.New("encrypted index has no compatibility metadata")
		}
		if _, err = db.Exec("CREATE TABLE encrypted_index_meta (kind TEXT NOT NULL, schema_version INTEGER NOT NULL, cipher_settings TEXT NOT NULL)"); err != nil {
			return err
		}
		_, err = db.Exec("INSERT INTO encrypted_index_meta VALUES (?, ?, ?)", kind, schema, string(encoded))
		return err
	}
	var storedKind, storedSettings string
	var storedSchema, rows int
	if err = db.QueryRow("SELECT count(*) FROM encrypted_index_meta").Scan(&rows); err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("invalid encrypted index compatibility metadata")
	}
	if err = db.QueryRow("SELECT kind, schema_version, cipher_settings FROM encrypted_index_meta").Scan(&storedKind, &storedSchema, &storedSettings); err != nil {
		return err
	}
	if storedKind != kind || storedSchema != schema || storedSettings != string(encoded) {
		return errors.New("incompatible encrypted index")
	}
	return nil
}
