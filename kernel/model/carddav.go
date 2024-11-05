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
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// REF: https://developers.google.com/people/carddav#resources
	CardDavPrefixPath        = "/carddav"
	CardDavRootPath          = CardDavPrefixPath + "/principals"      // 0 resourceTypeRoot
	CardDavUserPrincipalPath = CardDavRootPath + "/main"              // 1 resourceTypeUserPrincipal
	CardDavHomeSetPath       = CardDavUserPrincipalPath + "/contacts" // 2 resourceTypeAddressBookHomeSet

	CardDavDefaultAddressBookPath = CardDavHomeSetPath + "/default" // 3 resourceTypeAddressBook
	CardDavDefaultAddressBookName = "default"

	CardDavAddressBooksMetaDataFilePath = CardDavHomeSetPath + "/address-books.json"
)

var (
	defaultAddressBook = carddav.AddressBook{
		Path:            CardDavDefaultAddressBookPath,
		Name:            CardDavDefaultAddressBookName,
		Description:     "Default address book",
		MaxResourceSize: 0,
	}
	contacts = Contacts{
		loaded:        false,
		changed:       false,
		lock:          sync.Mutex{},
		books:         sync.Map{},
		booksMetaData: []*carddav.AddressBook{},
	}

	ErrorNotFound = errors.New("CardDAV: not found")

	ErrorBookNotFound    = errors.New("CardDAV: address book not found")
	ErrorBookPathInvalid = errors.New("CardDAV: address book path is invalid")

	ErrorAddressNotFound                 = errors.New("CardDAV: address not found")
	ErrorAddressFileExtensionNameInvalid = errors.New("CardDAV: address file extension name is invalid")
)

// CardDavPath2DirectoryPath converts CardDAV path to absolute path of the file system
func CardDavPath2DirectoryPath(cardDavPath string) string {
	return filepath.Join(util.DataDir, "storage", strings.TrimPrefix(cardDavPath, "/"))
}

// HomeSetPathPath returns the absolute path of the address book home set directory
func HomeSetPathPath() string {
	return CardDavPath2DirectoryPath(CardDavHomeSetPath)
}

// AddressBooksMetaDataFilePath returns the absolute path of the address books meta data file
func AddressBooksMetaDataFilePath() string {
	return CardDavPath2DirectoryPath(CardDavAddressBooksMetaDataFilePath)
}

// ParseAddressPath parses address path to address book path and address ID
func ParseAddressPath(addressParh string) (addressBookPath string, addressID string, err error) {
	addressBookPath, addressFileName := path.Split(addressParh)
	addressID = path.Base(addressFileName)
	addressFileExt := path.Ext(addressFileName)

	if len(strings.Split(addressBookPath, "/")) != 6 {
		err = ErrorBookPathInvalid
		return
	}

	if addressFileExt != ".vcf" {
		err = ErrorAddressFileExtensionNameInvalid
		return
	}

	return
}

func AddressPropsFilter(address *carddav.AddressObject, req *carddav.AddressDataRequest) *carddav.AddressObject {
	var card *vcard.Card
	if req.AllProp {
		card = &address.Card
	} else {
		card = &vcard.Card{}
		for _, prop := range req.Props {
			fields := address.Card[prop]
			if fields != nil {
				for _, field := range fields {
					card.Add(prop, field)
				}
			}
		}
	}
	return &carddav.AddressObject{
		Path:          address.Path,
		ModTime:       address.ModTime,
		ContentLength: address.ContentLength,
		ETag:          address.ETag,
		Card:          *card,
	}
}

type Contacts struct {
	loaded        bool
	changed       bool
	lock          sync.Mutex // load & save
	books         sync.Map   // Path -> *AddressBook
	booksMetaData []*carddav.AddressBook
}

// load all contacts
func (c *Contacts) load() error {
	c.books.Clear()
	addressBooksMetaDataFilePath := AddressBooksMetaDataFilePath()
	metaData, err := os.ReadFile(addressBooksMetaDataFilePath)
	if os.IsNotExist(err) {
		c.booksMetaData = []*carddav.AddressBook{&defaultAddressBook}
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}
	} else {
		// load meta data file
		c.booksMetaData = []*carddav.AddressBook{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.booksMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}
	}

	wg := &sync.WaitGroup{}
	wg.Add(len(c.booksMetaData))
	for _, addressBookMetaData := range c.booksMetaData {
		addressBook := &AddressBook{
			Changed:       false,
			DirectoryPath: CardDavPath2DirectoryPath(addressBookMetaData.Path),
			MetaData:      addressBookMetaData,
			Addresses:     sync.Map{},
		}
		c.books.Store(addressBookMetaData.Path, addressBook)
		go func() {
			defer wg.Done()
			addressBook.load()
		}()
	}
	wg.Wait()

	c.loaded = true
	c.changed = false
	return nil
}

// save all contacts
func (c *Contacts) save(force bool) error {
	if force || c.changed {
		// save address books meta data
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}

		// save all address to *.vbf files
		wg := &sync.WaitGroup{}
		c.books.Range(func(path any, book any) bool {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// path_ := path.(string)
				book_ := book.(*AddressBook)
				book_.save(force)
			}()
			return true
		})
		wg.Wait()
		c.changed = false
	}
	return nil
}

// save all contacts
func (c *Contacts) saveAddressBooksMetaData() error {
	data, err := gulu.JSON.MarshalIndentJSON(c.booksMetaData, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal address books meta data failed: %s", err)
		return err
	}

	dirPath := HomeSetPathPath()
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", dirPath, err)
		return err
	}

	filePath := AddressBooksMetaDataFilePath()
	if err := os.WriteFile(filePath, data, 0755); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", filePath, err)
		return err
	}

	return nil
}

func (c *Contacts) Load() error {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !c.loaded {
		return c.load()
	}
	return nil
}

func (c *Contacts) ListAddressBooks() (addressBooks []carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, addressBook := range contacts.booksMetaData {
		addressBooks = append(addressBooks, *addressBook)
	}
	return
}

func (c *Contacts) GetAddressBook(path string) (addressBook *carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if book, ok := contacts.books.Load(path); ok {
		addressBook = book.(*AddressBook).MetaData
		return
	}

	err = ErrorBookNotFound
	return
}

func (c *Contacts) CreateAddressBook(addressBookMetaData *carddav.AddressBook) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook

	// update map
	if value, ok := c.books.Load(addressBookMetaData.Path); ok {
		// update map item
		addressBook = value.(*AddressBook)
		addressBook.MetaData = addressBookMetaData
	} else {
		// insert map item
		addressBook = &AddressBook{
			Changed:       false,
			DirectoryPath: CardDavPath2DirectoryPath(addressBookMetaData.Path),
			MetaData:      addressBookMetaData,
			Addresses:     sync.Map{},
		}
		c.books.Store(addressBookMetaData.Path, addressBook)
	}

	var index = -1
	for i, item := range c.booksMetaData {
		if item.Path == addressBookMetaData.Path {
			index = i
			break
		}
	}

	if index >= 0 {
		// update list
		c.booksMetaData[index] = addressBookMetaData
	} else {
		// insert list
		c.booksMetaData = append(c.booksMetaData, addressBookMetaData)
	}

	// create address book directory
	if err = os.MkdirAll(addressBook.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", addressBook, err)
		return
	}

	// save meta data
	if err = c.saveAddressBooksMetaData(); err != nil {
		return
	}

	return
}

func (c *Contacts) DeleteAddressBook(path string) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook

	// delete map item
	if value, loaded := c.books.LoadAndDelete(path); loaded {
		addressBook = value.(*AddressBook)
	}

	// delete list item
	for i, item := range c.booksMetaData {
		if item.Path == path {
			c.booksMetaData = append(c.booksMetaData[:i], c.booksMetaData[i+1:]...)
			break
		}
	}

	// remove address book directory
	if err = os.RemoveAll(addressBook.DirectoryPath); err != nil {
		logging.LogErrorf("remove directory [%s] failed: %s", addressBook, err)
		return
	}

	// save meta data
	if err = c.saveAddressBooksMetaData(); err != nil {
		return
	}

	return nil
}

func (c *Contacts) GetAddressObject(addressPath string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	bookPath, addressID, err := ParseAddressPath(addressPath)
	if err != nil {
		logging.LogErrorf("parse address path [%s] failed: %s", addressPath, err)
		return
	}

	var addressBook *AddressBook
	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorBookNotFound
		return
	}

	if value, ok := addressBook.Addresses.Load(addressID); ok {
		addressObject = AddressPropsFilter(value.(*AddressObject).Data, req)
	} else {
		err = ErrorAddressNotFound
		return
	}

	return
}

func (c *Contacts) ListAddressObjects(bookPath string, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook
	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorBookNotFound
		return
	}

	addressBook.Addresses.Range(func(id any, address any) bool {
		addressObjects = append(addressObjects, *AddressPropsFilter(address.(*AddressObject).Data, req))
		return true
	})

	return
}

func (c *Contacts) QueryAddressObjects(addressPath string, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()
	// TODO
	return
}

func (c *Contacts) PutAddressObject(addressPath string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (addressObject *carddav.AddressObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	bookPath, addressID, err := ParseAddressPath(addressPath)
	if err != nil {
		logging.LogErrorf("parse address path [%s] failed: %s", addressPath, err)
		return
	}

	var addressBook *AddressBook
	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorBookNotFound
		return
	}

	var address *AddressObject
	if value, ok := addressBook.Addresses.Load(addressID); ok {
		address = value.(*AddressObject)

		if opts.IfNoneMatch.IsSet() {
			addressObject = address.Data
			return
		}

		address.Data.Card = card
		address.Changed = true
	} else {
		address = &AddressObject{
			Changed:  true,
			FilePath: CardDavPath2DirectoryPath(addressPath),
			BookPath: bookPath,
			Data: &carddav.AddressObject{
				Card: card,
			},
		}
	}

	err = address.save(true)
	if err != nil {
		return
	}

	err = address.update()
	if err != nil {
		return
	}

	addressBook.Addresses.Store(addressID, address)
	addressObject = address.Data
	return
}

func (c *Contacts) DeleteAddressObject(addressPath string) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	bookPath, addressID, err := ParseAddressPath(addressPath)
	if err != nil {
		logging.LogErrorf("parse address path [%s] failed: %s", addressPath, err)
		return
	}

	var addressBook *AddressBook
	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorBookNotFound
		return
	}

	if value, loaded := addressBook.Addresses.LoadAndDelete(addressID); loaded {
		address := value.(*AddressObject)

		if err = os.Remove(address.FilePath); err != nil {
			logging.LogErrorf("remove file [%s] failed: %s", address.FilePath, err)
			return
		}
	}

	return
}

type AddressBook struct {
	Changed       bool
	DirectoryPath string
	MetaData      *carddav.AddressBook
	Addresses     sync.Map // id -> *AddressObject
}

// load an address book from multiple *.vcf files
func (b *AddressBook) load() error {
	if err := os.MkdirAll(b.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", b.DirectoryPath, err)
		return err
	}

	entries, err := os.ReadDir(b.DirectoryPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", b.DirectoryPath, err)
		return err
	}

	wg := &sync.WaitGroup{}
	for _, entry := range entries {
		if !entry.IsDir() {
			filename := entry.Name()
			ext := path.Ext(filename)
			if ext == ".vcf" {
				wg.Add(1)
				go func() {
					defer wg.Done()

					addressFilePath := path.Join(b.DirectoryPath, filename)

					// load data
					address := &AddressObject{
						FilePath: addressFilePath,
						BookPath: b.MetaData.Path,
					}
					if err := address.load(); err != nil {
						return
					}

					id := path.Base(filename)
					b.Addresses.Store(id, address)
				}()
			}
		}
	}
	wg.Wait()
	return nil
}

// save an address book to multiple *.vcf files
func (b *AddressBook) save(force bool) error {
	if force || b.Changed {
		// create directory
		if err := os.MkdirAll(b.DirectoryPath, 0755); err != nil {
			logging.LogErrorf("create directory [%s] failed: %s", b.DirectoryPath, err)
			return err
		}

		wg := &sync.WaitGroup{}
		b.Addresses.Range(func(id any, address any) bool {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// id_ := id.(string)
				address_ := address.(*AddressObject)
				address_.save(force)
				address_.update()
			}()
			return true
		})
		wg.Wait()
		b.Changed = false
	}

	return nil
}

type AddressObject struct {
	Changed  bool
	FilePath string
	BookPath string
	Data     *carddav.AddressObject
}

// load an address from *.vcf file
func (o *AddressObject) load() error {
	// get file info
	addressFileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}

	// read file
	addressData, err := os.ReadFile(o.FilePath)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", o.FilePath, err)
		return err
	}

	// decode file
	reader := bytes.NewReader(addressData)
	decoder := vcard.NewDecoder(reader)
	card, err := decoder.Decode()
	if err != nil {
		logging.LogErrorf("decode file [%s] failed: %s", o.FilePath, err)
		return err
	}

	// load data
	o.Changed = false
	o.Data = &carddav.AddressObject{
		Path:          o.BookPath + "/" + addressFileInfo.Name(),
		ModTime:       addressFileInfo.ModTime(),
		ContentLength: addressFileInfo.Size(),
		ETag:          fmt.Sprintf("%x-%x", addressFileInfo.ModTime(), addressFileInfo.Size()),
		Card:          card,
	}
	return nil
}

// save an address to *.vcf file
func (o *AddressObject) save(force bool) error {
	if force || o.Changed {
		var addressData bytes.Buffer

		// encode data
		encoder := vcard.NewEncoder(&addressData)
		if err := encoder.Encode(o.Data.Card); err != nil {
			logging.LogErrorf("encode card [%s] failed: %s", o.Data.Path, err)
			return err
		}

		// create directory
		dirPath := path.Dir(o.FilePath)
		if err := os.MkdirAll(dirPath, 0755); err != nil {
			logging.LogErrorf("create directory [%s] failed: %s", dirPath, err)
			return err
		}

		// write file
		if err := os.WriteFile(o.FilePath, addressData.Bytes(), 0755); err != nil {
			logging.LogErrorf("write file [%s] failed: %s", o.FilePath, err)
			return err
		}

		o.Changed = false
	}
	return nil
}

// update file info
func (o *AddressObject) update() error {
	// update file info
	addressFileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}

	o.Data.Path = o.BookPath + "/" + addressFileInfo.Name()
	o.Data.ModTime = addressFileInfo.ModTime()
	o.Data.ContentLength = addressFileInfo.Size()
	o.Data.ETag = fmt.Sprintf("%x-%x", addressFileInfo.ModTime(), addressFileInfo.Size())

	return nil
}

type CardDavBackend struct{}

func (b *CardDavBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	return CardDavUserPrincipalPath, nil
}

func (b *CardDavBackend) AddressBookHomeSetPath(ctx context.Context) (string, error) {
	return CardDavHomeSetPath, nil
}

func (b *CardDavBackend) ListAddressBooks(ctx context.Context) (addressBooks []carddav.AddressBook, err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	addressBooks, err = contacts.ListAddressBooks()
	return
}

func (b *CardDavBackend) GetAddressBook(ctx context.Context, bookPath string) (addressBook *carddav.AddressBook, err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	addressBook, err = contacts.GetAddressBook(bookPath)
	return
}

func (b *CardDavBackend) CreateAddressBook(ctx context.Context, addressBook *carddav.AddressBook) (err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.CreateAddressBook(addressBook)
	return
}

func (b *CardDavBackend) DeleteAddressBook(ctx context.Context, bookPath string) (err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.DeleteAddressBook(bookPath)
	return
}

func (b *CardDavBackend) GetAddressObject(ctx context.Context, addressPath string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	addressObject, err = contacts.GetAddressObject(addressPath, req)
	return
}

func (b *CardDavBackend) ListAddressObjects(ctx context.Context, bookPath string, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	addressObjects, err = contacts.ListAddressObjects(bookPath, req)
	return
}

func (b *CardDavBackend) QueryAddressObjects(ctx context.Context, addressPath string, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	addressObjects, err = contacts.QueryAddressObjects(addressPath, query)
	return
}

func (b *CardDavBackend) PutAddressObject(ctx context.Context, addressPath string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (addressObject *carddav.AddressObject, err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	addressObject, err = contacts.PutAddressObject(addressPath, card, opts)
	return
}

func (b *CardDavBackend) DeleteAddressObject(ctx context.Context, addressPath string) (err error) {
	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.DeleteAddressObject(addressPath)
	return
}
