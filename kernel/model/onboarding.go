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
	"errors"
	"path/filepath"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var onboardingLock sync.Mutex

func prepareOnboardingForEmptyWorkspace(onboarding *conf.Onboarding, readOnly bool, notebookCount int) bool {
	if readOnly || notebookCount > 0 {
		return false
	}
	onboarding.State = conf.OnboardingPending
	onboarding.NewUser = true
	onboarding.Dismissed = false
	onboarding.NotebookID = ""
	onboarding.DocumentID = ""
	return true
}

func EnsureOnboarding() (ret *conf.Onboarding, notebookCreated bool, err error) {
	onboardingLock.Lock()
	defer onboardingLock.Unlock()

	if nil == Conf.Onboarding {
		Conf.Onboarding = &conf.Onboarding{State: conf.OnboardingCompleted}
		Conf.Save()
	}
	onboarding := Conf.Onboarding
	if !onboarding.NewUser || onboarding.State == conf.OnboardingCompleted {
		return cloneOnboarding(onboarding), false, nil
	}
	if util.ReadOnly || Conf.Publish.Enable {
		return cloneOnboarding(onboarding), false, errors.New(Conf.Language(34))
	}

	if onboarding.NotebookID == "" {
		if boxes, listErr := ListNotebooks(); listErr != nil {
			return cloneOnboarding(onboarding), false, listErr
		} else if len(boxes) > 0 {
			if len(boxes) == 1 && boxes[0].Name == Conf.Language(342) {
				onboarding.NotebookID = boxes[0].ID
				onboarding.State = conf.OnboardingNotebookCreated
				Conf.Save()
			} else {
				onboarding.State = conf.OnboardingCompleted
				onboarding.NewUser = false
				Conf.Save()
				return cloneOnboarding(onboarding), false, nil
			}
		}

		if onboarding.NotebookID == "" {
			onboarding.NotebookID, err = CreateBox(Conf.Language(342))
			if err != nil {
				return cloneOnboarding(onboarding), false, err
			}
			onboarding.State = conf.OnboardingNotebookCreated
			Conf.Save()
			notebookCreated = true
		}
	}

	if _, mountErr := Mount(onboarding.NotebookID); mountErr != nil {
		return cloneOnboarding(onboarding), notebookCreated, mountErr
	}
	if onboarding.DocumentID == "" {
		onboarding.DocumentID = ast.NewNodeID()
		Conf.Save()
	}

	docPath := "/" + onboarding.DocumentID + ".sy"
	docAbsPath := filepath.Join(util.DataDir, onboarding.NotebookID, onboarding.DocumentID+".sy")
	if !filelock.IsExist(docAbsPath) {
		if _, err = CreateDocByMd(onboarding.NotebookID, docPath, Conf.Language(343), "", nil, nil); err != nil {
			return cloneOnboarding(onboarding), notebookCreated, err
		}
	}
	onboarding.State = conf.OnboardingCompleted
	Conf.Save()
	return cloneOnboarding(onboarding), notebookCreated, nil
}

func DismissOnboarding() *conf.Onboarding {
	onboardingLock.Lock()
	defer onboardingLock.Unlock()

	if nil == Conf.Onboarding {
		Conf.Onboarding = &conf.Onboarding{State: conf.OnboardingCompleted}
	}
	Conf.Onboarding.Dismissed = true
	Conf.Save()
	return cloneOnboarding(Conf.Onboarding)
}

func cloneOnboarding(onboarding *conf.Onboarding) *conf.Onboarding {
	if nil == onboarding {
		return nil
	}
	ret := *onboarding
	return &ret
}
