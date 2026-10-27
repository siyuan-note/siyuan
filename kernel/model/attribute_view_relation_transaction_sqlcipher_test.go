//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationConfigurationEncryptedTransactionRollback(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	testRelationConfigurationTransactionRollback(t, func(t *testing.T) string {
		return newStructuredTitlesEncryptedBox(t)
	})
}
