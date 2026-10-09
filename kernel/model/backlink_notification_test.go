package model

import (
	"reflect"
	"testing"

	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBackmentionNotifierLegacyAndSuppressed(t *testing.T) {
	if reflect.ValueOf(backmentionNotifier(nil)).Pointer() != reflect.ValueOf(util.PushMsg).Pointer() {
		t.Fatal("omitted notifier must retain legacy broadcast")
	}
	if backmentionNotifier([]BackmentionNotifier{nil}) != nil {
		t.Fatal("explicit nil notifier must suppress notification")
	}
}

func TestBackmentionKeywordWarningNotifier(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	Conf.Search.BacklinkMentionKeywordsLimit = 0
	Conf.Search.Limit = 0
	t.Cleanup(func() { Conf = previous })
	calls := 0
	notify := func(msg string, timeout int) string {
		calls++
		if timeout != 5000 {
			t.Fatalf("warning timeout = %d", timeout)
		}
		return "warning"
	}
	searchBackmention([]string{"first", "second"}, "", hashset.New(), "root", 12, notify)
	if calls != 1 {
		t.Fatalf("warning invoked notifier %d times", calls)
	}
	searchBackmention([]string{"first", "second"}, "", hashset.New(), "root", 12, nil)
	searchBackmention([]string{"first"}, "", hashset.New(), "root", 12, notify)
	if calls != 1 {
		t.Fatal("suppressed or below-limit search emitted warning")
	}
}
