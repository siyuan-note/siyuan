// SiYuan - Refactor your thinking
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

package client

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type oauthCredential struct {
	ServerID            string    `json:"serverId"`
	Endpoint            string    `json:"endpoint"`
	Resource            string    `json:"resource"`
	Issuer              string    `json:"issuer"`
	ResourceMetadataURL string    `json:"resourceMetadataUrl,omitempty"`
	RedirectURL         string    `json:"redirectUrl,omitempty"`
	ClientID            string    `json:"clientId"`
	ClientSecret        string    `json:"clientSecret,omitempty"`
	ClientSecretExpiry  time.Time `json:"clientSecretExpiry,omitempty"`
	TokenEndpoint       string    `json:"tokenEndpoint"`
	RevocationEndpoint  string    `json:"revocationEndpoint,omitempty"`
	TokenAuthMethod     string    `json:"tokenAuthMethod,omitempty"`
	AccessToken         string    `json:"accessToken"`
	RefreshToken        string    `json:"refreshToken,omitempty"`
	TokenType           string    `json:"tokenType,omitempty"`
	Expiry              time.Time `json:"expiry,omitempty"`
	Scopes              []string  `json:"scopes,omitempty"`
	Rejected            bool      `json:"rejected,omitempty"`
}

type oauthCredentialData struct {
	Credentials []oauthCredential `json:"credentials"`
}

var oauthCredentialStore = struct {
	sync.Mutex
	loaded      bool
	credentials []oauthCredential
}{}

func loadOAuthCredentialsLocked() {
	if oauthCredentialStore.loaded {
		return
	}
	oauthCredentialStore.loaded = true
	oauthCredentialStore.credentials = []oauthCredential{}
	if model.Conf == nil || model.Conf.GetMCPOAuth() == "" {
		return
	}

	ciphertext := model.Conf.GetMCPOAuth()
	if len(ciphertext)%32 != 0 {
		logging.LogWarnf("mcp oauth: ignored malformed encrypted credentials")
		return
	}
	decrypted := decryptOAuthCredentials(ciphertext)
	if len(decrypted) == 0 {
		return
	}
	plain, err := hex.DecodeString(string(decrypted))
	if err != nil {
		logging.LogWarnf("mcp oauth: decode credentials failed: %s", err)
		return
	}
	data := &oauthCredentialData{}
	if err = json.Unmarshal(plain, data); err != nil {
		logging.LogWarnf("mcp oauth: parse credentials failed: %s", err)
		return
	}
	oauthCredentialStore.credentials = data.Credentials
}

func decryptOAuthCredentials(ciphertext string) (decrypted []byte) {
	defer func() {
		if recovered := recover(); recovered != nil {
			logging.LogWarnf("mcp oauth: decrypt credentials failed: %v", recovered)
			decrypted = nil
		}
	}()
	return util.AESDecrypt(ciphertext)
}

func persistOAuthCredentialsLocked() error {
	if model.Conf == nil {
		return fmt.Errorf("configuration is not initialized")
	}
	data, err := json.Marshal(&oauthCredentialData{Credentials: oauthCredentialStore.credentials})
	if err != nil {
		return err
	}
	model.Conf.SetMCPOAuth(util.AESEncrypt(string(data)))
	return nil
}

func getOAuthCredential(serverID, endpoint string) (oauthCredential, bool) {
	oauthCredentialStore.Lock()
	defer oauthCredentialStore.Unlock()
	loadOAuthCredentialsLocked()
	for i := len(oauthCredentialStore.credentials) - 1; i >= 0; i-- {
		credential := oauthCredentialStore.credentials[i]
		credentialEndpoint := credential.Endpoint
		if credentialEndpoint == "" {
			credentialEndpoint = credential.Resource
		}
		if credential.ServerID == serverID && credentialEndpoint == endpoint {
			return credential, true
		}
	}
	return oauthCredential{}, false
}

func putOAuthCredential(credential oauthCredential) error {
	oauthCredentialStore.Lock()
	defer oauthCredentialStore.Unlock()
	loadOAuthCredentialsLocked()
	filtered := oauthCredentialStore.credentials[:0]
	for _, item := range oauthCredentialStore.credentials {
		itemEndpoint := item.Endpoint
		if itemEndpoint == "" {
			itemEndpoint = item.Resource
		}
		credentialEndpoint := credential.Endpoint
		if credentialEndpoint == "" {
			credentialEndpoint = credential.Resource
		}
		if item.ServerID == credential.ServerID && itemEndpoint == credentialEndpoint && item.Issuer == credential.Issuer {
			continue
		}
		filtered = append(filtered, item)
	}
	oauthCredentialStore.credentials = append(filtered, credential)
	return persistOAuthCredentialsLocked()
}

func removeOAuthCredential(serverID, resource, issuer string) error {
	oauthCredentialStore.Lock()
	defer oauthCredentialStore.Unlock()
	loadOAuthCredentialsLocked()
	filtered := oauthCredentialStore.credentials[:0]
	for _, credential := range oauthCredentialStore.credentials {
		if credential.ServerID == serverID && (resource == "" || credential.Resource == resource) && (issuer == "" || credential.Issuer == issuer) {
			continue
		}
		filtered = append(filtered, credential)
	}
	oauthCredentialStore.credentials = filtered
	return persistOAuthCredentialsLocked()
}

func markOAuthCredentialRejected(serverID, endpoint string) error {
	oauthCredentialStore.Lock()
	defer oauthCredentialStore.Unlock()
	loadOAuthCredentialsLocked()
	for i := len(oauthCredentialStore.credentials) - 1; i >= 0; i-- {
		credential := &oauthCredentialStore.credentials[i]
		credentialEndpoint := credential.Endpoint
		if credentialEndpoint == "" {
			credentialEndpoint = credential.Resource
		}
		if credential.ServerID != serverID || credentialEndpoint != endpoint {
			continue
		}
		credential.Rejected = true
		return persistOAuthCredentialsLocked()
	}
	return nil
}

func listOAuthCredentials(serverID string) []oauthCredential {
	oauthCredentialStore.Lock()
	defer oauthCredentialStore.Unlock()
	loadOAuthCredentialsLocked()
	var result []oauthCredential
	for _, credential := range oauthCredentialStore.credentials {
		if credential.ServerID == serverID {
			result = append(result, credential)
		}
	}
	return result
}

func hasOAuthCredential(serverID, endpoint string) bool {
	credential, ok := getOAuthCredential(serverID, endpoint)
	return ok && (strings.TrimSpace(credential.AccessToken) != "" || strings.TrimSpace(credential.RefreshToken) != "")
}
