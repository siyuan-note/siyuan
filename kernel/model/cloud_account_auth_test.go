package model

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupCloudAccountAuthTest(t *testing.T) *conf.User {
	t.Helper()
	oldConf, oldConfDir, oldRegion, oldReadOnly := Conf, util.ConfDir, util.CurrentCloudRegion, util.ReadOnly
	oldData, oldRepo, oldHistory, oldTemp := util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir
	t.Cleanup(func() {
		Conf, util.ConfDir, util.CurrentCloudRegion, util.ReadOnly = oldConf, oldConfDir, oldRegion, oldReadOnly
		util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir = oldData, oldRepo, oldHistory, oldTemp
	})
	Conf = NewAppConf()
	Conf.Sync, Conf.Repo, Conf.System = conf.NewSync(), conf.NewRepo(), conf.NewSystem()
	Conf.Sync.Enabled, Conf.Sync.Provider, Conf.Sync.CloudName = true, conf.ProviderSiYuan, "main"
	Conf.Repo.Key = []byte("0123456789abcdef0123456789abcdef")
	util.ConfDir, util.CurrentCloudRegion, util.ReadOnly = t.TempDir(), 0, false
	util.DataDir, util.RepoDir = filepath.Join(util.ConfDir, "data"), filepath.Join(util.ConfDir, "repo")
	util.HistoryDir, util.TempDir = filepath.Join(util.ConfDir, "history"), filepath.Join(util.ConfDir, "temp")
	user := &conf.User{UserId: "owner", UserName: "alice", UserToken: "old-token"}
	Conf.SetUser(user)
	Conf.UserData = "persisted-user"
	Conf.Save()
	return user
}

func assertCloudAccountLoggedOut(t *testing.T) {
	t.Helper()
	if Conf.GetUser() != nil || Conf.UserData != "" {
		t.Fatal("authentication failure retained login state")
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		UserData string `json:"userData"`
	}
	if err = json.Unmarshal(data, &saved); err != nil || saved.UserData != "" {
		t.Fatalf("authentication failure retained persisted credentials: %v", err)
	}
	if !Conf.Sync.Enabled || Conf.Sync.CloudName != "main" || string(Conf.Repo.Key) != "0123456789abcdef0123456789abcdef" {
		t.Fatal("logout changed sync configuration or recovery key")
	}
}

func TestCloudRepoAuthFailureLogsOutWithSourceLocked(t *testing.T) {
	setupCloudAccountAuthTest(t)
	release := lockAssetSourceChange()
	defer release()
	handle := cloudRepoErrorHandler()
	handle(fmt.Errorf("sync failed: %w", cloud.ErrCloudAuthFailed))
	assertCloudAccountLoggedOut(t)
	handle(cloud.ErrCloudAuthFailed)
	assertCloudAccountLoggedOut(t)
}

func TestListCloudSyncDirAuthenticationFailure(t *testing.T) {
	setupCloudAccountAuthTest(t)
	called := false
	mockCloudAuthResponse(t, func(request *http.Request) (*http.Response, error) {
		called = true
		return cloudAuthResponse(request, http.StatusUnauthorized, ""), nil
	})
	if _, _, err := ListCloudSyncDir(); err == nil || !called {
		t.Fatalf("cloud request did not fail with authentication error: %v", err)
	}
	assertCloudAccountLoggedOut(t)
}

func TestCloudRepoAuthFailurePreservesOtherSessions(t *testing.T) {
	for _, name := range []string{"network", "subscription", "s3", "webdav", "refreshed token", "changed account", "changed region", "logged out"} {
		t.Run(name, func(t *testing.T) {
			user := setupCloudAccountAuthTest(t)
			if name == "s3" {
				Conf.Sync.Provider = conf.ProviderS3
			}
			if name == "webdav" {
				Conf.Sync.Provider = conf.ProviderWebDAV
			}
			handle := cloudRepoErrorHandler()
			err := cloud.ErrCloudAuthFailed
			switch name {
			case "network":
				err = errors.New("connection timeout")
			case "subscription":
				err = cloud.ErrCloudForbidden
			case "refreshed token":
				user = &conf.User{UserId: user.UserId, UserToken: "new-token"}
				Conf.SetUser(user)
			case "changed account":
				user = &conf.User{UserId: "other-owner", UserToken: user.UserToken}
				Conf.SetUser(user)
			case "changed region":
				util.CurrentCloudRegion = 1
			case "logged out":
				user = nil
				Conf.SetUser(nil)
			}
			handle(err)
			if Conf.GetUser() != user || Conf.UserData != "persisted-user" {
				t.Fatal("unrelated failure changed the current session")
			}
		})
	}
}

type cloudAuthTestTransport func(*http.Request) (*http.Response, error)

func (transport cloudAuthTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func mockCloudAuthResponse(t *testing.T, respond cloudAuthTestTransport) {
	t.Helper()
	client := httpclient.NewCloudRequest30s().GetClient().GetClient()
	previous := client.Transport
	client.Transport = respond
	t.Cleanup(func() { client.Transport = previous })
}

func cloudAuthResponse(request *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: request}
}

func TestCloudAccountRequestAuthenticationFailure(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			user := setupCloudAccountAuthTest(t)
			mockCloudAuthResponse(t, func(request *http.Request) (*http.Response, error) {
				cookie, err := request.Cookie("symphony")
				if err != nil || cookie.Value != user.UserToken {
					t.Error("request did not use the captured account token")
				}
				return cloudAuthResponse(request, status, `{"code":-1,"msg":"rejected"}`), nil
			})
			if _, err := GetCloudShorthands(1); err == nil {
				t.Fatal("expected a request error")
			}
			if status == http.StatusUnauthorized {
				assertCloudAccountLoggedOut(t)
			} else if Conf.GetUser() != user || Conf.UserData != "persisted-user" {
				t.Fatal("non-authentication response logged out the account")
			}
		})
	}
}

func TestCloudUserRefreshCannotRestoreRejectedSession(t *testing.T) {
	user := setupCloudAccountAuthTest(t)
	invalid := cloudAccountAuthFailureHandler(user.UserToken)
	data, err := json.Marshal(user)
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(util.SK)
	if err != nil {
		t.Fatal(err)
	}
	padding := block.BlockSize() - len(data)%block.BlockSize()
	data = append(data, bytes.Repeat([]byte{byte(padding)}, padding)...)
	cipher.NewCBCEncrypter(block, []byte("RandomInitVector")).CryptBlocks(data, data)
	body, err := json.Marshal(map[string]any{"code": 0, "data": hex.EncodeToString(data)})
	if err != nil {
		t.Fatal(err)
	}
	reject := false
	mockCloudAuthResponse(t, func(request *http.Request) (*http.Response, error) {
		if reject {
			invalid()
		}
		return cloudAuthResponse(request, http.StatusOK, string(body)), nil
	})
	if _, err = RefreshUser(user.UserToken); err != nil {
		t.Fatalf("control refresh failed: %v", err)
	}
	reject = true
	if _, err = RefreshUser(user.UserToken); err == nil {
		t.Fatal("stale refresh succeeded")
	}
	assertCloudAccountLoggedOut(t)
}

func TestCloudUserRefreshAuthenticationFailure(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusOK} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			user := setupCloudAccountAuthTest(t)
			mockCloudAuthResponse(t, func(request *http.Request) (*http.Response, error) {
				return cloudAuthResponse(request, status, `{"code":255}`), nil
			})
			if _, err := RefreshUser(user.UserToken); !IsInvalidUserRefresh(err) {
				t.Fatalf("expected invalid credentials: %v", err)
			}
			assertCloudAccountLoggedOut(t)
		})
	}
}

func TestCloudAccountRequestCannotLogOutNewToken(t *testing.T) {
	setupCloudAccountAuthTest(t)
	newUser := &conf.User{UserId: "owner", UserToken: "new-token"}
	mockCloudAuthResponse(t, func(request *http.Request) (*http.Response, error) {
		Conf.SetUser(newUser)
		return cloudAuthResponse(request, http.StatusUnauthorized, ""), nil
	})
	if _, err := GetCloudShorthands(1); err == nil {
		t.Fatal("expected authentication error for the old request")
	}
	if Conf.GetUser() != newUser || Conf.UserData != "persisted-user" {
		t.Fatal("old request cleared the new login state")
	}
}
