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
	"bytes"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetMaskedConfHidesCookieKeyAndPreservesOIDCSecret(t *testing.T) {
	const cookieKey = "session-cookie-signing-key"

	originalConf := Conf
	defer func() {
		Conf = originalConf
	}()

	Conf = NewAppConf()
	Conf.CookieKey = cookieKey
	Conf.OIDC.ClientSecret = "oidc-client-secret"

	maskedConf, err := GetMaskedConf()
	if err != nil {
		t.Fatal(err)
	}
	if "" != maskedConf.CookieKey {
		t.Fatalf("cookie key was not hidden: %q", maskedConf.CookieKey)
	}
	if cookieKey != Conf.CookieKey {
		t.Fatalf("cookie key in the runtime configuration was changed: %q", Conf.CookieKey)
	}
	if maskedConf.OIDC.ClientSecret != "oidc-client-secret" {
		t.Fatalf("OIDC client secret was not preserved: %#v", maskedConf.OIDC)
	}
	if Conf.OIDC.ClientSecret != "oidc-client-secret" {
		t.Fatalf("OIDC client secret in runtime configuration was changed: %q", Conf.OIDC.ClientSecret)
	}
}

func TestHideConfSecretPreservesNotebookCryptoSettings(t *testing.T) {
	appConf := NewAppConf()
	appConf.CookieKey = "session-cookie-signing-key"
	appConf.System = &conf.System{}
	kek := bytes.Repeat([]byte{1}, 32)
	verifier, err := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:kek-verifier"))
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := util.EncryptionNonce(verifier)
	if err != nil {
		t.Fatal(err)
	}
	appConf.NotebookCrypto = conf.NewNotebookCrypto()
	appConf.NotebookCrypto.Enabled = true
	appConf.NotebookCrypto.MasterSalt = bytes.Repeat([]byte{2}, 16)
	appConf.NotebookCrypto.KEKVerifier = verifier
	appConf.NotebookCrypto.VerifierNonce = nonce
	appConf.NotebookCrypto.AutoLockMinutes = 17
	prepareBackupForWrite(appConf.NotebookCrypto)
	appConf.NotebookCrypto.KEKMAC = computeKEKMAC(appConf.NotebookCrypto, kek)

	HideConfSecret(appConf)

	if "" != appConf.CookieKey {
		t.Fatalf("cookie key was not hidden: %q", appConf.CookieKey)
	}
	notebookCrypto := appConf.NotebookCrypto
	if nil == notebookCrypto {
		t.Fatal("notebook crypto settings should be preserved")
	}
	if !notebookCrypto.Enabled || 17 != notebookCrypto.AutoLockMinutes {
		t.Fatalf("functional notebook crypto settings were changed: %#v", notebookCrypto)
	}
	if 0 < len(notebookCrypto.MasterSalt) ||
		(util.Argon2Params{} != notebookCrypto.KDFParams) ||
		0 < len(notebookCrypto.KEKVerifier) ||
		0 < len(notebookCrypto.VerifierNonce) ||
		0 != notebookCrypto.Spec ||
		"" != notebookCrypto.BackupID ||
		0 != notebookCrypto.CreatedAt ||
		"" != notebookCrypto.Checksum ||
		0 < len(notebookCrypto.KEKMAC) {
		t.Fatalf("notebook crypto key material was not hidden: %#v", notebookCrypto)
	}
}

func TestHideConfSecretMasksIncompleteNotebookCryptoAsDisabled(t *testing.T) {
	appConf := NewAppConf()
	appConf.System = &conf.System{}
	appConf.NotebookCrypto = conf.NewNotebookCrypto()
	appConf.NotebookCrypto.Enabled = true

	HideConfSecret(appConf)

	if appConf.NotebookCrypto.Enabled {
		t.Fatal("incomplete notebook crypto configuration should not be exposed as enabled")
	}
}

func TestHideConfSecretHidesAbsolutePaths(t *testing.T) {
	appConf := NewAppConf()
	appConf.Export = &conf.Export{
		AddTitle:  true,
		PandocBin: `C:\Users\alice\SiYuan\temp\pandoc\bin\pandoc.exe`,
	}
	appConf.System = &conf.System{
		KernelVersion: "3.3.0",
		HomeDir:       `C:\Users\alice`,
		WorkspaceDir:  `C:\Users\alice\SiYuan`,
		AppDir:        `C:\Program Files\SiYuan`,
		ConfDir:       `C:\Users\alice\SiYuan\conf`,
		DataDir:       `C:\Users\alice\SiYuan\data`,
	}

	HideConfSecret(appConf)

	if "" != appConf.Export.PandocBin {
		t.Fatalf("pandoc path was not hidden: %q", appConf.Export.PandocBin)
	}
	if !appConf.Export.AddTitle {
		t.Fatal("functional export settings should be preserved")
	}
	if "" != appConf.System.HomeDir ||
		"" != appConf.System.WorkspaceDir ||
		"" != appConf.System.AppDir ||
		"" != appConf.System.ConfDir ||
		"" != appConf.System.DataDir {
		t.Fatalf("system paths were not hidden: %#v", appConf.System)
	}
	if "3.3.0" != appConf.System.KernelVersion {
		t.Fatalf("functional system settings were changed: %#v", appConf.System)
	}
}

func TestHideBoxConfSecretPreservesNotebookSettings(t *testing.T) {
	boxConf := &conf.BoxConf{
		Name:      "Encrypted notebook",
		Sort:      7,
		Icon:      "1f512",
		Closed:    true,
		SortMode:  util.SortModeCustom,
		Encrypted: true,
		BoxCrypt: &conf.BoxEncryption{
			Spec:       1,
			WrappedDEK: []byte("wrapped-dek"),
			WrapNonce:  []byte("wrap-nonce"),
			CreatedAt:  123,
		},
	}

	HideBoxConfSecret(boxConf)

	if nil != boxConf.BoxCrypt {
		t.Fatalf("wrapped notebook key was not hidden: %#v", boxConf.BoxCrypt)
	}
	if "Encrypted notebook" != boxConf.Name ||
		7 != boxConf.Sort ||
		"1f512" != boxConf.Icon ||
		!boxConf.Closed ||
		util.SortModeCustom != boxConf.SortMode ||
		!boxConf.Encrypted {
		t.Fatalf("functional notebook settings were changed: %#v", boxConf)
	}
}
