// 包 chatgpt 管理 ChatGPT 套餐授权，凭证与工作空间数据分开保存。
package chatgpt

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gofrs/flock"
	"golang.org/x/crypto/pbkdf2"
)

const Issuer = "https://auth.openai.com"
const Resource = "https://api.openai.com/v1"
const permission = "chatgpt.tokens.use.direct"

type Account struct {
	ClientID     string   `json:"client_id"`
	Subject      string   `json:"subject"`
	Email        string   `json:"email,omitempty"`
	Name         string   `json:"name,omitempty"`
	AccessToken  string   `json:"access_token,omitempty"`
	RefreshToken string   `json:"refresh_token,omitempty"`
	IDToken      string   `json:"id_token,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
	ExpiresAt    int64    `json:"expires_at"`
}

type Profile struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
	Sharing   bool   `json:"sharing"`
}

type diskStore struct {
	Version  int        `json:"version"`
	HostID   string     `json:"hostID"`
	Accounts []*Account `json:"accounts"`
}

type Service struct {
	dir      string
	mu       sync.Mutex
	attempts map[string]*attempt
	http     HTTPClient
	issuer   string
	resource string
	requests map[string]map[*activeRequest]bool
	blocked  map[string]bool
}

type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Open 只定位主机私有目录，首次操作时才创建凭证文件。
func Open(dir string, clients ...HTTPClient) *Service {
	client := HTTPClient(newHTTPClient())
	if len(clients) > 0 {
		client = clients[0]
	}
	return &Service{dir: dir, attempts: map[string]*attempt{}, http: client, issuer: Issuer, resource: Resource,
		requests: map[string]map[*activeRequest]bool{}, blocked: map[string]bool{}}
}

func randomText(size int) string {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(value)
}

func atomicWrite(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".chatgpt-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}

func seal(key, plain []byte, aad string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, []byte(aad)), nil
}

func unseal(key, data []byte, aad string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("invalid encrypted ChatGPT account")
	}
	return gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(aad))
}

// withStore 在进程间加锁后重新读取凭证，轮换令牌与到期信息一同写入。
func (s *Service) withStore(ctx context.Context, update func(*diskStore) error) error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	lock := flock.New(filepath.Join(s.dir, "accounts.lock"))
	locked, err := lock.TryLockContext(ctx, 50*time.Millisecond)
	if err != nil {
		return err
	}
	if !locked {
		return ctx.Err()
	}
	defer lock.Unlock()
	keyPath := filepath.Join(s.dir, "key")
	key, err := os.ReadFile(keyPath)
	if os.IsNotExist(err) {
		if _, statErr := os.Stat(filepath.Join(s.dir, "accounts")); !os.IsNotExist(statErr) {
			return errors.New("ChatGPT credential key is missing; preserve the credential files")
		}
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return err
		}
		err = atomicWrite(keyPath, key)
	}
	if err != nil {
		return err
	}
	store := &diskStore{Version: 1, HostID: "urn:uuid:" + randomUUID(), Accounts: []*Account{}}
	data, err := os.ReadFile(filepath.Join(s.dir, "accounts"))
	if err == nil {
		plain, decryptErr := unseal(key, data, "siyuan-chatgpt-store-v1")
		if decryptErr != nil {
			return errors.New("ChatGPT credential authentication failed; preserve the credential files")
		}
		if err = json.Unmarshal(plain, store); err != nil {
			return err
		}
		if store.Version != 1 || store.HostID == "" {
			return errors.New("unsupported ChatGPT credential format")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = update(store); err != nil {
		return err
	}
	plain, err := json.Marshal(store)
	if err != nil {
		return err
	}
	data, err = seal(key, plain, "siyuan-chatgpt-store-v1")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(s.dir, "accounts"), data)
}

func randomUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func findAccount(store *diskStore, id string) (*Account, error) {
	for _, a := range store.Accounts {
		if a.ClientID == id {
			return a, nil
		}
	}
	return nil, errors.New("ChatGPT account is not registered")
}

func profile(a *Account) Profile {
	return Profile{ID: a.ClientID, Email: a.Email, Name: a.Name, Connected: a.AccessToken != "",
		Sharing: a.AccessToken != "" && slices.Contains(a.Scopes, permission)}
}

func (s *Service) Profiles(ctx context.Context) (ret []Profile, err error) {
	ret = []Profile{}
	err = s.withStore(ctx, func(store *diskStore) error {
		for _, a := range store.Accounts {
			ret = append(ret, profile(a))
		}
		return nil
	})
	return
}

type transfer struct {
	Version int    `json:"version"`
	Salt    []byte `json:"salt"`
	Data    []byte `json:"data"`
}

// Export 将可续期会话转交给目标主机，保留本机账户映射并停止本机后续刷新。
func (s *Service) Export(ctx context.Context, id, password string, publish func(string) error) (result string, err error) {
	if utf8.RuneCountInString(password) < 12 {
		return "", errors.New("account transfer password must contain at least 12 characters")
	}
	s.stopRequests(id)
	defer func() {
		if err != nil {
			s.resumeRequests(id)
		}
	}()
	err = s.withStore(ctx, func(store *diskStore) error {
		a, err := findAccount(store, id)
		if err != nil {
			return err
		}
		if a.RefreshToken == "" {
			return errors.New("sign in to ChatGPT before transferring this account")
		}
		plain, err := json.Marshal(a)
		if err != nil {
			return err
		}
		bundle := transfer{Version: 1, Salt: make([]byte, 32)}
		if _, err = rand.Read(bundle.Salt); err != nil {
			return err
		}
		key := pbkdf2.Key([]byte(password), bundle.Salt, 600000, 32, sha256.New)
		bundle.Data, err = seal(key, plain, "siyuan-chatgpt-transfer-v1")
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(bundle)
		if err != nil {
			return err
		}
		result = string(encoded)
		if publish != nil {
			if err = publish(result); err != nil {
				return err
			}
		}
		clearTokens(a)
		return nil
	})
	return
}

// Import 认证导入文件并校验注册身份，目标主机始终保留自己的主机标识。
func (s *Service) Import(ctx context.Context, data, password string) (result Profile, err error) {
	if utf8.RuneCountInString(password) < 12 || len(data) > 1024*1024 {
		return result, errors.New("invalid ChatGPT account transfer")
	}
	var bundle transfer
	if err = json.Unmarshal([]byte(data), &bundle); err != nil {
		return
	}
	if bundle.Version != 1 || len(bundle.Salt) != 32 {
		return result, errors.New("unsupported ChatGPT account transfer format")
	}
	key := pbkdf2.Key([]byte(password), bundle.Salt, 600000, 32, sha256.New)
	plain, err := unseal(key, bundle.Data, "siyuan-chatgpt-transfer-v1")
	if err != nil {
		return result, errors.New("ChatGPT account transfer authentication failed")
	}
	var account Account
	if err = json.Unmarshal(plain, &account); err != nil {
		return
	}
	if account.ClientID == "" || account.ClientID == "dynamic_agent_client" || account.Subject == "" || account.RefreshToken == "" {
		return result, errors.New("invalid ChatGPT account registration")
	}
	identity, err := s.verifyIdentity(ctx, account.IDToken, account.ClientID, "", true)
	if err != nil || identity.Subject != account.Subject {
		return result, errors.New("ChatGPT account identity mismatch")
	}
	err = s.withStore(ctx, func(store *diskStore) error {
		if err := s.refresh(ctx, &account); err != nil {
			return err
		}
		for i, a := range store.Accounts {
			if a.ClientID == account.ClientID {
				if a.Subject != "" && a.Subject != account.Subject {
					return errors.New("ChatGPT account identity mismatch")
				}
				store.Accounts[i] = &account
				result = profile(&account)
				return nil
			}
		}
		store.Accounts = append(store.Accounts, &account)
		result = profile(&account)
		return nil
	})
	if err == nil {
		s.resumeRequests(result.ID)
	}
	return
}

func clearTokens(a *Account) {
	a.AccessToken = ""
	a.RefreshToken = ""
	a.IDToken = ""
	a.Scopes = nil
	a.ExpiresAt = 0
}
