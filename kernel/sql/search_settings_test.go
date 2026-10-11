package sql

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSearchSettingsBeforeDatabaseInitialization(t *testing.T) {
	previousDB, previousCase, previousHan, previousAssets := db, caseSensitive, hanSensitive, indexAssetPath
	previousUtilCase, previousUtilHan := util.SearchCaseSensitive, util.SearchHanSensitive
	t.Cleanup(func() {
		db, caseSensitive, hanSensitive, indexAssetPath = previousDB, previousCase, previousHan, previousAssets
		util.SearchCaseSensitive, util.SearchHanSensitive = previousUtilCase, previousUtilHan
	})
	db = nil
	for _, sensitive := range []bool{true, false} {
		SetCaseSensitive(sensitive)
		SetHanSensitive(sensitive)
		SetIndexAssetPath(sensitive)
		if util.SearchCaseSensitive != sensitive || util.SearchHanSensitive != sensitive || indexAssetPath != sensitive {
			t.Fatal("search settings were not applied before opening the database")
		}
		for _, option := range []string{"case_insensitive", "han_insensitive"} {
			if strings.Contains(ftsTokenize(), option) == sensitive {
				t.Fatalf("new FTS tables would use the wrong setting: %s", ftsTokenize())
			}
		}
	}
}
