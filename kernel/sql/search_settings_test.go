package sql

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSearchSettingsBeforeDatabaseInitialization(t *testing.T) {
	previousDB, previousCase, previousHan, previousAssets := db, caseSensitive.Load(), hanSensitive.Load(), indexAssetPath.Load()
	previousUtilCase, previousUtilHan := util.SearchCaseSensitive.Load(), util.SearchHanSensitive.Load()
	t.Cleanup(func() {
		{
			derivedValue0, derivedValue1, derivedValue2, derivedValue3 := previousDB, previousCase, previousHan, previousAssets
			db = derivedValue0
			caseSensitive.Store(derivedValue1)
			hanSensitive.Store(derivedValue2)
			indexAssetPath.Store(derivedValue3)
		}
		{
			derivedValue0, derivedValue1 := previousUtilCase, previousUtilHan
			util.SearchCaseSensitive.Store(derivedValue0)
			util.SearchHanSensitive.Store(derivedValue1)
		}
	})
	db = nil
	for _, sensitive := range []bool{true, false} {
		SetCaseSensitive(sensitive)
		SetHanSensitive(sensitive)
		SetIndexAssetPath(sensitive)
		if util.SearchCaseSensitive.Load() != sensitive || util.SearchHanSensitive.Load() != sensitive || indexAssetPath.Load() != sensitive {
			t.Fatal("search settings were not applied before opening the database")
		}
		for _, option := range []string{"case_insensitive", "han_insensitive"} {
			if strings.Contains(ftsTokenize(), option) == sensitive {
				t.Fatalf("new FTS tables would use the wrong setting: %s", ftsTokenize())
			}
		}
	}
}
