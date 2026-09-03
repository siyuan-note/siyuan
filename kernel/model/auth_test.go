// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func preserveAuthState(t *testing.T) {
	t.Helper()
	originalConf := Conf
	accountsLock.RLock()
	originalAccounts := accountsMap
	accountsLock.RUnlock()
	t.Cleanup(func() {
		Conf = originalConf
		accountsLock.Lock()
		accountsMap = originalAccounts
		accountsLock.Unlock()
	})
}

func resetPublishSessions(t *testing.T) {
	t.Helper()
	sessionLock.Lock()
	original := sessionsMap
	sessionsMap = map[string]*PublishSession{}
	sessionLock.Unlock()
	t.Cleanup(func() {
		sessionLock.Lock()
		sessionsMap = original
		sessionLock.Unlock()
	})
}

func resetPublishAccounts(t *testing.T) {
	t.Helper()
	accountsLock.Lock()
	original := accountsMap
	accountsMap = AccountsMap{}
	accountsLock.Unlock()
	t.Cleanup(func() {
		accountsLock.Lock()
		accountsMap = original
		accountsLock.Unlock()
	})
}

func addTestPublishAccount(username string) *Account {
	account := &Account{Username: username, CredentialVersion: "credential-" + username}
	accountsLock.Lock()
	accountsMap[username] = account
	accountsLock.Unlock()
	return account
}

func TestAddPublishSessionReusesSessionForSameUsername(t *testing.T) {
	resetPublishSessions(t)
	resetPublishAccounts(t)
	account := addTestPublishAccount("alice")

	first := AddSession(account.Username, account.CredentialVersion)
	if second := AddSession(account.Username, account.CredentialVersion); second != first {
		t.Fatalf("session ID = %q, want reused %q", second, first)
	}

	sessionLock.Lock()
	size := len(sessionsMap)
	sessionLock.Unlock()
	if 1 != size {
		t.Fatalf("session registry size = %d, want 1", size)
	}
}

func TestPublishSessionExpiresAfterInactivity(t *testing.T) {
	resetPublishSessions(t)
	resetPublishAccounts(t)
	account := addTestPublishAccount("alice")

	sessionID := AddSession(account.Username, account.CredentialVersion)
	sessionLock.Lock()
	sessionsMap[sessionID].LastActive = time.Now().Add(-publishSessionTTL - time.Second)
	sessionLock.Unlock()

	if account = GetBasicAuthAccountBySessionID(sessionID); nil != account {
		t.Fatalf("expired session account = %+v, want nil", account)
	}

	sessionLock.Lock()
	_, exists := sessionsMap[sessionID]
	sessionLock.Unlock()
	if exists {
		t.Fatal("expired session was not removed from the registry")
	}
}

func TestPublishSessionGlobalCapEvictsOldest(t *testing.T) {
	resetPublishSessions(t)
	resetPublishAccounts(t)

	base := time.Now()
	ids := make([]string, publishSessionGlobalCap)
	for i := range ids {
		account := addTestPublishAccount("user-" + strconv.Itoa(i))
		ids[i] = AddSession(account.Username, account.CredentialVersion)
	}
	sessionLock.Lock()
	for i, id := range ids {
		sessionsMap[id].LastActive = base.Add(time.Duration(i) * time.Second)
	}
	sessionLock.Unlock()

	account := addTestPublishAccount("overflow")
	newID := AddSession(account.Username, account.CredentialVersion)
	sessionLock.Lock()
	defer sessionLock.Unlock()
	if publishSessionGlobalCap != len(sessionsMap) {
		t.Fatalf("session registry size = %d, want %d", len(sessionsMap), publishSessionGlobalCap)
	}
	if _, ok := sessionsMap[ids[0]]; ok {
		t.Fatal("oldest session was not evicted when exceeding the global cap")
	}
	if _, ok := sessionsMap[ids[len(ids)-1]]; !ok {
		t.Fatal("most recently active session was unexpectedly evicted")
	}
	if _, ok := sessionsMap[newID]; !ok {
		t.Fatal("new session was not registered")
	}
}

func TestPublishSessionPerAccountCapEvictsOldest(t *testing.T) {
	resetPublishSessions(t)

	base := time.Now()
	sessionLock.Lock()
	for i := 0; i < publishSessionPerAccountCap; i++ {
		sessionsMap["id-"+strconv.Itoa(i)] = &PublishSession{
			Username:   "alice",
			LastActive: base.Add(time.Duration(i) * time.Second),
		}
	}
	evictOldestPublishSessionByUsername("alice")
	if publishSessionPerAccountCap-1 != len(sessionsMap) {
		t.Fatalf("session registry size = %d, want %d", len(sessionsMap), publishSessionPerAccountCap-1)
	}
	if _, ok := sessionsMap["id-0"]; ok {
		t.Fatal("oldest session of the account was not evicted")
	}
	sessionLock.Unlock()
}

func TestPublishSessionInvalidatedAfterPasswordChange(t *testing.T) {
	InitJwtKey()
	preserveAuthState(t)
	resetPublishSessions(t)

	Conf = NewAppConf()
	Conf.Publish = conf.NewPublish()
	Conf.Publish.Auth.Accounts = []*conf.BasicAuthAccount{
		{Username: "alice", Password: "old-password"},
		{Username: "bob", Password: "bob-password"},
	}
	InitPublishAccounts()

	alice := GetBasicAuthAccount("alice")
	bob := GetBasicAuthAccount("bob")
	aliceSessionID := AddSession(alice.Username, alice.CredentialVersion)
	bobSessionID := AddSession(bob.Username, bob.CredentialVersion)

	Conf.Publish.Auth.Accounts[0].Password = "new-password"
	InitPublishAccounts()

	if sessionID := AddSession(alice.Username, alice.CredentialVersion); "" != sessionID {
		t.Fatalf("stale credentials created session %q", sessionID)
	}
	if account := GetBasicAuthAccountBySessionID(aliceSessionID); nil != account {
		t.Fatalf("password-changed account session remained valid: %+v", account)
	}
	if account := GetBasicAuthAccountBySessionID(bobSessionID); nil == account {
		t.Fatal("unchanged account session became invalid")
	}
}

func TestPublishSessionPreservedWhenCredentialsUnchanged(t *testing.T) {
	InitJwtKey()
	preserveAuthState(t)
	resetPublishSessions(t)

	Conf = NewAppConf()
	Conf.Publish = conf.NewPublish()
	Conf.Publish.Auth.Accounts = []*conf.BasicAuthAccount{
		{Username: "alice", Password: "same-password"},
	}
	InitPublishAccounts()

	alice := GetBasicAuthAccount("alice")
	sessionID := AddSession(alice.Username, alice.CredentialVersion)
	InitPublishAccounts()

	if account := GetBasicAuthAccountBySessionID(sessionID); nil == account {
		t.Fatal("session became invalid although credentials were unchanged")
	}
}

func TestIsPublishServiceToken(t *testing.T) {
	tests := []struct {
		name      string
		token     *jwt.Token
		isPublish bool
	}{
		{name: "nil"},
		{
			name: "invalid",
			token: &jwt.Token{
				Claims: jwt.MapClaims{"iss": iss, "aud": publishServiceAudience},
			},
		},
		{
			name: "wrong issuer",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": "other", "aud": publishServiceAudience},
			},
		},
		{
			name: "wrong audience",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": iss, "aud": "siyuan-kernel-plugin"},
			},
		},
		{
			name: "publish audience",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": iss, "aud": publishServiceAudience},
			},
			isPublish: true,
		},
		{
			name: "publish audience list",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": iss, "aud": []string{"other", publishServiceAudience}},
			},
			isPublish: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := IsPublishServiceToken(test.token); actual != test.isPublish {
				t.Fatalf("IsPublishServiceToken() = %v, want %v", actual, test.isPublish)
			}
		})
	}
}

func TestInitPublishAccountsWithNilAuth(t *testing.T) {
	InitJwtKey()
	preserveAuthState(t)

	Conf = NewAppConf()
	Conf.Publish = &conf.Publish{Enable: true, Port: 6808}

	defer func() {
		if e := recover(); nil != e {
			t.Fatalf("InitPublishAccounts panicked on nil Publish.Auth: %v", e)
		}
	}()
	InitPublishAccounts()

	if nil == Conf.Publish.Auth {
		t.Fatal("InitPublishAccounts should default Publish.Auth when it is nil")
	}
}

func TestJWTLifecycle(t *testing.T) {
	InitJwtKey()
	preserveAuthState(t)

	pluginToken, err := CreatePluginJWT("test-plugin")
	if err != nil {
		t.Fatalf("CreatePluginJWT failed: %v", err)
	}
	InitJwtKey()
	if _, err = ParseJWT(pluginToken); err != nil {
		t.Fatalf("plugin JWT became invalid after repeated key initialization: %v", err)
	}

	Conf = NewAppConf()
	InitPublishAccounts()
	firstPublishAccount := GetBasicAuthAccount("")
	if firstPublishAccount == nil {
		t.Fatal("anonymous publish account is missing")
	}
	if _, err = ParseJWT(firstPublishAccount.Token); err != nil {
		t.Fatalf("current publish JWT is invalid: %v", err)
	}

	InitPublishAccounts()
	if _, err = ParseJWT(pluginToken); err != nil {
		t.Fatalf("plugin JWT became invalid after publish account initialization: %v", err)
	}
	if _, err = ParseJWT(firstPublishAccount.Token); !errors.Is(err, ErrInvalidPublishServiceToken) {
		t.Fatalf("stale publish JWT error = %v, want %v", err, ErrInvalidPublishServiceToken)
	}
	refreshedPublishAccount := GetBasicAuthAccount("")
	if refreshedPublishAccount == nil {
		t.Fatal("refreshed anonymous publish account is missing")
	}
	if _, err = ParseJWT(refreshedPublishAccount.Token); err != nil {
		t.Fatalf("refreshed publish JWT is invalid: %v", err)
	}
}

func TestConcurrentPublishAccountRefreshAndJWTParsing(t *testing.T) {
	InitJwtKey()
	preserveAuthState(t)

	Conf = NewAppConf()
	InitPublishAccounts()
	account := GetBasicAuthAccount("")
	if account == nil {
		t.Fatal("anonymous publish account is missing")
	}

	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		for i := 0; i < 100; i++ {
			InitPublishAccounts()
		}
	}()
	go func() {
		defer wait.Done()
		for i := 0; i < 100; i++ {
			_, _ = ParseJWT(account.Token)
		}
	}()
	wait.Wait()
}
