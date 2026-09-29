package model

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCloudLockErrorDetail(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"dns", &url.Error{Op: "Post", URL: "https://user:password@up.qbox.me/private?token=secret", Err: &net.DNSError{Err: "no such host", Name: "up.qbox.me"}}, "408 [up.qbox.me]"},
		{"timeout", &url.Error{URL: "https://user:password@example.com/private?token=secret", Err: context.DeadlineExceeded}, "24 [example.com]"},
		{"deadline", context.DeadlineExceeded, "24"},
		{"connection", &url.Error{URL: "https://example.com/private", Err: &net.OpError{Op: "read", Net: "tcp", Err: errors.New("connection aborted")}}, "409 [example.com]"},
		{"eof", io.EOF, "409"},
		{"unexpected eof", io.ErrUnexpectedEOF, "409"},
		{"permission", &os.PathError{Op: "open", Path: "private/path", Err: os.ErrPermission}, "33"},
		{"unknown", errors.New("<script>secret</script> token=secret"), ""},
		{"invalid dns host", &net.DNSError{Err: "no such host", Name: "<img src=x onerror=alert(1)>"}, "408"},
		{"dns query", &net.DNSError{Err: "no such host", Name: "example.com?token=secret"}, "408"},
		{"ipv6", &url.Error{URL: "https://[::1]:443/?token=secret", Err: io.EOF}, "409 [::1]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := fmt.Errorf("%w: %w", dejavu.ErrLockCloudFailed, tc.err)
			got := cloudLockErrorDetail(err, func(number int) string { return fmt.Sprint(number) })
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFormatRepoCloudLockError(t *testing.T) {
	previousConf, previousLangs := Conf, util.Langs
	t.Cleanup(func() { Conf, util.Langs = previousConf, previousLangs })
	Conf = &AppConf{Lang: "en", Sync: &conf.Sync{Provider: conf.ProviderSiYuan}}
	util.Langs = map[string]map[int]string{"en": {
		24: "timeout", 31: "auth", 188: "lock failed", 189: "another device", 249: "forbidden", 408: "DNS failed",
	}}
	dns := fmt.Errorf("%w: %w", dejavu.ErrLockCloudFailed, &url.Error{
		URL: "https://user:password@up.qbox.me/private?token=secret",
		Err: &net.DNSError{Err: "no such host", Name: "up.qbox.me"},
	})
	for _, tc := range []struct {
		err  error
		want string
	}{
		{dns, "lock failed DNS failed [up.qbox.me]"},
		{dejavu.ErrLockCloudFailed, "lock failed"},
		{fmt.Errorf("%w: secret", dejavu.ErrLockCloudFailed), "lock failed"},
		{dejavu.ErrCloudLocked, "another device"},
		{cloud.ErrCloudAuthFailed, "auth"},
		{cloud.ErrCloudForbidden, "forbidden"},
	} {
		got := formatRepoErrorMsg(tc.err)
		want := tc.want + " (Provider: " + conf.ProviderToStr(conf.ProviderSiYuan) + ")"
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
		for _, secret := range []string{"password", "token", "secret", "/private"} {
			if strings.Contains(got, secret) {
				t.Fatalf("sensitive detail in message: %q", got)
			}
		}
	}
}
