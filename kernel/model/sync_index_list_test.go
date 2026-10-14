package model

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestSyncCloudIndexListNoticeLifecycle(t *testing.T) {
	var notice syncCloudIndexListNotice
	var pending []func()
	var shown, hidden []string
	observer := func(source string) func(error) {
		return notice.observer(source, func(err error) string { return err.Error() }, func(callback func()) { pending = append(pending, callback) },
			func(message string) string { shown = append(shown, message); return fmt.Sprint(len(shown)) }, func(id string) { hidden = append(hidden, id) })
	}
	first := observer("first")
	first(errors.New("listing denied"))
	first(errors.New("listing denied"))
	if len(pending) != 1 || len(shown) != 0 {
		t.Fatal("duplicate failure was queued or shown before the UI was ready")
	}
	first(nil)
	pending[0]()
	if len(shown) != 0 {
		t.Fatal("resolved startup warning was shown")
	}
	first(errors.New("listing denied again"))
	pending[1]()
	if len(shown) != 1 {
		t.Fatal("new failure was not shown")
	}
	observer("first")(errors.New("same source, another repo"))
	if len(pending) != 2 {
		t.Fatal("another repository duplicated the current warning")
	}
	second := observer("second")
	if len(hidden) != 1 || hidden[0] != "1" {
		t.Fatal("source change did not remove the old warning")
	}
	first(errors.New("late result"))
	if len(pending) != 2 {
		t.Fatal("old source result created a warning")
	}
	second(errors.New("second source failure"))
	pending[2]()
	second(nil)
	if len(hidden) != 2 || hidden[1] != "2" {
		t.Fatal("successful listing did not clear its warning")
	}
	observer("first")
	first(errors.New("old first source generation"))
	if len(pending) != 3 {
		t.Fatal("returning to a source revived an obsolete callback")
	}
	current := observer("first")
	current(errors.New("pending before configuration edit"))
	notice.reset(func(id string) { hidden = append(hidden, id) })
	pending[3]()
	current(errors.New("late result after configuration edit"))
	if len(shown) != 2 || len(pending) != 4 {
		t.Fatal("configuration edit did not cancel old requests and queued warnings")
	}
	observer("first")(errors.New("new request after configuration edit"))
	pending[4]()
	notice.reset(func(id string) { hidden = append(hidden, id) })
	if len(hidden) != 3 || hidden[2] != "3" {
		t.Fatal("configuration edit did not remove an existing warning")
	}
}

func TestSyncCloudIndexListConcurrentFailures(t *testing.T) {
	var notice syncCloudIndexListNotice
	queued := make(chan func(), 20)
	observer := notice.observer("source", func(error) string { return "failed" }, func(callback func()) { queued <- callback },
		func(string) string { return "message" }, func(string) {})
	var wait sync.WaitGroup
	for range 20 {
		wait.Go(func() { observer(errors.New("failed")) })
	}
	wait.Wait()
	if len(queued) != 1 {
		t.Fatalf("concurrent listing errors queued %d warnings", len(queued))
	}
	(<-queued)()
	observer(nil)
}

func TestSyncCloudIndexListWarningRedactsRequestDetails(t *testing.T) {
	language := func(key int) string {
		if key == 420 {
			return "Cannot list cloud sync indexes (%s). This does not mean the cloud is empty."
		}
		return fmt.Sprintf("localized-%d", key)
	}
	for _, err := range []error{
		errors.New("https://user:secret@service.example/?token=private <script>"),
		&url.Error{Op: "Get", URL: "https://user:secret@service.example/?token=private", Err: &net.DNSError{Name: "service.example", Err: "no such host"}},
		fmt.Errorf("secret body: %w", cloud.ErrCloudAuthFailed),
		fmt.Errorf("private: %w", cloud.ErrCloudForbidden),
	} {
		message := syncCloudIndexListWarning(conf.ProviderS3, err, language)
		for _, private := range []string{"secret", "private", "token=", "<script>", "user:"} {
			if strings.Contains(message, private) {
				t.Fatalf("request detail leaked in warning: %s", message)
			}
		}
		if !strings.Contains(message, "S3") || !strings.Contains(message, "does not mean") {
			t.Fatalf("warning did not distinguish listing failure from an empty cloud: %s", message)
		}
	}
	if message := syncCloudIndexListWarning(conf.ProviderS3, cloud.ErrCloudAuthFailed, language); strings.Contains(message, "localized-31") || !strings.Contains(message, "localized-249") {
		t.Fatal("third-party authentication error instructed the user to log in to the SiYuan account")
	}
	if message := syncCloudIndexListWarning(conf.ProviderSiYuan, cloud.ErrCloudAuthFailed, language); !strings.Contains(message, "localized-31") {
		t.Fatal("SiYuan authentication error omitted account guidance")
	}
}
