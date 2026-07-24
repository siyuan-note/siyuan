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

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHideConfSecretPreservesNotebookCryptoSettings(t *testing.T) {
	appConf := NewAppConf()
	appConf.System = &conf.System{}
	appConf.NotebookCrypto = &conf.NotebookCrypto{
		Enabled:         true,
		MasterSalt:      []byte("master-salt"),
		KDFParams:       util.DefaultArgon2Params(),
		KEKVerifier:     []byte("kek-verifier"),
		VerifierNonce:   []byte("verifier-nonce"),
		AutoLockMinutes: 17,
		Spec:            conf.CurrentNotebookCryptoSpec,
		BackupID:        "backup-id",
		CreatedAt:       123,
		Checksum:        "checksum",
		KEKMAC:          []byte("kek-mac"),
	}

	HideConfSecret(appConf)

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
