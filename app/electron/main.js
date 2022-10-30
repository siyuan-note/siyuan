// SiYuan - Build Your Eternal Digital Garden
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

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  screen,
  nativeTheme,
  ipcMain,
  globalShortcut,
  Tray,
} = require('electron')
const path = require('path')
const fs = require('fs')
const fetch = require('electron-fetch').default
process.noAsar = true
const appDir = path.dirname(app.getAppPath())
const isDevEnv = process.env.NODE_ENV === 'development'
const appVer = app.getVersion()
const confDir = path.join(app.getPath('home'), '.config', 'siyuan')
const windowStatePath = path.join(confDir, 'windowState.json')
const portJSONPath = path.join(confDir, 'port.json')
let tray // 托盘必须使用全局变量，以防止被垃圾回收 https://www.electronjs.org/docs/faq#my-apps-windowtray-disappeared-after-a-few-minutes
let mainWindow // 从托盘处激活报错 https://github.com/siyuan-note/siyuan/issues/769
let firstOpenWindow, bootWindow
let closeButtonBehavior = 0
let siyuanOpenURL
let firstOpen = false
let resetWindowStateOnRestart = false
let kernelPort = "6806"
const localhost = "127.0.0.1"
require('@electron/remote/main').initialize()

if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}

const getServer = () => {
  return "http://" + localhost + ":" + kernelPort
}

const showErrorWindow = (title, content) => {
  let errorHTMLPath = path.join(appDir, 'app', 'electron', 'error.html')
  if (isDevEnv) {
    errorHTMLPath = path.join(appDir, 'electron', 'error.html')
  }
  const errWindow = new BrowserWindow({
    width: screen.getPrimaryDisplay().size.width / 2,
    height: screen.getPrimaryDisplay().workAreaSize.height / 2,
    frame: false,
    icon: path.join(appDir, 'stage', 'icon-large.png'),
    webPreferences: {
      nativeWindowOpen: true,
      nodeIntegration: true,
      webviewTag: true,
      webSecurity: false,
      contextIsolation: false,
    },
  })
  require('@electron/remote/main').enable(errWindow.webContents)
  errWindow.loadFile(errorHTMLPath, {
    query: {
      home: app.getPath('home'),
      v: appVer,
      title: title,
      content: content,
      icon: path.join(appDir, 'stage', 'icon-large.png'),
    },
  })
  errWindow.show()
}

try {
  firstOpen = !fs.existsSync(path.join(confDir, 'workspace.json'))
  if (!fs.existsSync(confDir)) {
    fs.mkdirSync(confDir, {mode: 0o755, recursive: true})
  }
} catch (e) {
  console.error(e)
  require('electron').dialog.showErrorBox('创建配置目录失败 Failed to create config directory',
    '思源需要在用户家目录下创建配置文件夹（~/.config/siyuan），请确保该路径具有写入权限。\n\nSiYuan needs to create a configuration folder (~/.config/siyuan) in the user\'s home directory. Please make sure that the path has write permissions.')
  app.exit()
}

const writeLog = (out) => {
  console.log(out)
  const logFile = path.join(confDir, 'app.log')
  let log = ''
  const maxLogLines = 1024
  try {
    if (fs.existsSync(logFile)) {
      log = fs.readFileSync(logFile).toString()
      let lines = log.split('\n')
      if (maxLogLines < lines.length) {
        log = lines.slice(maxLogLines / 2, maxLogLines).join('\n') + '\n'
      }
    }
    out = out.toString()
    out = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '') + ' ' +
      out
    log += out + '\n'
    fs.writeFileSync(logFile, log)
  } catch (e) {
    console.error(e)
  }
}

const boot = () => {
  // 恢复主窗体状态
  let oldWindowState = {}
  try {
    oldWindowState = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'))
  } catch (e) {
    fs.writeFileSync(windowStatePath, '{}')
  }
  let defaultWidth
  let defaultHeight
  let workArea
  try {
    defaultWidth = screen.getPrimaryDisplay().size.width * 4 / 5
    defaultHeight = screen.getPrimaryDisplay().workAreaSize.height * 4 / 5
    workArea = screen.getPrimaryDisplay().workArea
  } catch (e) {
    console.error(e)
  }
  const windowState = Object.assign({}, {
    isMaximized: true,
    fullscreen: false,
    isDevToolsOpened: false,
    x: 0, y: 0,
    width: defaultWidth,
    height: defaultHeight,
  }, oldWindowState)

  let x = windowState.x
  let y = windowState.y
  if (workArea) {
    // 窗口大小等同于或大于 workArea 时，缩小会隐藏到左下角
    if (windowState.width >= workArea.width || windowState.height >=
      workArea.height) {
      windowState.width = Math.min(defaultWidth, workArea.width)
      windowState.height = Math.min(defaultHeight, workArea.height)
    }
    if (x > workArea.width) {
      x = 0
    }
    if (y > workArea.height) {
      y = 0
    }
  }
  if (windowState.width < 400) {
    windowState.width = 400
  }
  if (windowState.height < 300) {
    windowState.height = 300
  }
  if (x < 0) {
    x = 0
  }
  if (y < 0) {
    y = 0
  }

  // 创建主窗体
  mainWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#FFF', // 桌面端主窗体背景色设置为 `#FFF` Fix https://github.com/siyuan-note/siyuan/issues/4544
    width: windowState.width,
    height: windowState.height,
    x,
    y,
    fullscreenable: true,
    fullscreen: windowState.fullscreen,
    trafficLightPosition: {x: 8, y: 8},
    webPreferences: {
      nodeIntegration: true,
      nativeWindowOpen: true,
      webviewTag: true,
      webSecurity: false,
      contextIsolation: false,
    },
    frame: 'darwin' === process.platform,
    titleBarStyle: 'hidden',
    icon: path.join(appDir, 'stage', 'icon-large.png'),
  })

  require('@electron/remote/main').enable(mainWindow.webContents)
  mainWindow.webContents.userAgent = 'SiYuan/' + appVer +
    ' https://b3log.org/siyuan Electron'

  // 发起互联网服务请求时绕过安全策略 https://github.com/siyuan-note/siyuan/issues/5516
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, cb) => {
      if (-1 < details.url.indexOf('bili')) {
        // B 站不移除 Referer https://github.com/siyuan-note/siyuan/issues/94
        cb({requestHeaders: details.requestHeaders})
        return
      }

      for (let key in details.requestHeaders) {
        if ('referer' === key.toLowerCase()) {
          delete details.requestHeaders[key]
        }
      }
      cb({requestHeaders: details.requestHeaders})
    })
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    for (let key in details.responseHeaders) {
      if ('x-frame-options' === key.toLowerCase()) {
        delete details.responseHeaders[key]
      } else if ('content-security-policy' === key.toLowerCase()) {
        delete details.responseHeaders[key]
      } else if ('access-control-allow-origin' === key.toLowerCase()) {
        delete details.responseHeaders[key]
      }
    }
    cb({responseHeaders: details.responseHeaders})
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if ('win32' === process.platform || 'linux' === process.platform) {
      siyuanOpenURL = process.argv.find((arg) => arg.startsWith('siyuan://'))
    }
    if (siyuanOpenURL) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      setTimeout(() => { // 等待界面js执行完毕
        writeLog(siyuanOpenURL)
        mainWindow.webContents.send('siyuan-openurl', siyuanOpenURL)
        siyuanOpenURL = null
      }, 2000)
    }
  })

  if (windowState.isDevToolsOpened) {
    mainWindow.webContents.openDevTools({mode: 'bottom'})
  }

  // 主界面事件监听
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (windowState.isMaximized) {
      mainWindow.maximize()
    } else {
      mainWindow.unmaximize()
    }
    if (bootWindow && !bootWindow.isDestroyed()) {
      bootWindow.destroy()
    }
  })

  // 加载主界面
  mainWindow.loadURL(getServer() + '/stage/build/app/index.html?v=' +
    new Date().getTime())

  // 菜单
  const productName = 'SiYuan'
  const template = [
    {
      label: productName,
      submenu: [
        {
          label: `About ${productName}`,
          role: 'about',
        },
        {type: 'separator'},
        {role: 'services'},
        {type: 'separator'},
        {
          label: `Hide ${productName}`,
          role: 'hide',
        },
        {role: 'hideOthers'},
        {role: 'unhide'},
        {type: 'separator'},
        {
          label: `Quit ${productName}`,
          role: 'quit',
        },
      ],
    },
    {
      role: 'editMenu',
      submenu: [
        {role: 'cut'},
        {role: 'copy'},
        {role: 'paste'},
        {role: 'pasteAndMatchStyle', accelerator: 'CmdOrCtrl+Shift+C'},
        {role: 'selectAll'},
      ],
    },
    {
      role: 'viewMenu',
      submenu: [
        {role: 'resetZoom'},
        {role: 'zoomIn', accelerator: 'CommandOrControl+='},
        {role: 'zoomOut'},
      ],
    },
    {
      role: 'windowMenu',
      submenu: [
        {role: 'minimize'},
        {role: 'zoom'},
        {role: 'togglefullscreen'},
        {type: 'separator'},
        {role: 'toggledevtools'},
        {type: 'separator'},
        {role: 'front'},
      ],
    },
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  // 当前页面链接使用浏览器打开
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(getServer())) {
      return
    }

    event.preventDefault()
    shell.openExternal(url)
  })

  mainWindow.on('close', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('siyuan-save-close', false)
    }
    event.preventDefault()
  })
  nativeTheme.on('updated', () => {
    mainWindow.webContents.send('siyuan-update-theme', {
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      init: false,
    })
  })
  // 监听主题切换
  ipcMain.on('siyuan-config-theme', (event, theme) => {
    nativeTheme.themeSource = theme
  })
  ipcMain.on('siyuan-config-close', (event, close) => {
    closeButtonBehavior = close
  })
  ipcMain.on('siyuan-config-tray', () => {
    mainWindow.hide()
  })
  ipcMain.on('siyuan-config-closetray', () => {
    if ('win32' === process.platform) {
      tray.destroy()
    }
  })
  ipcMain.on('siyuan-export-pdf', (event, data) => {
    mainWindow.webContents.send('siyuan-export-pdf', data)
  })
  ipcMain.on('siyuan-export-close', (event, data) => {
    mainWindow.webContents.send('siyuan-export-close', data)
  })
  ipcMain.on('siyuan-quit', () => {
    try {
      if (resetWindowStateOnRestart) {
        fs.writeFileSync(windowStatePath, '{}')
      } else {
        const bounds = mainWindow.getBounds()
        fs.writeFileSync(windowStatePath, JSON.stringify({
          isMaximized: mainWindow.isMaximized(),
          fullscreen: mainWindow.isFullScreen(),
          isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }))
      }
    } catch (e) {
      writeLog(e)
    }
    app.exit()
    globalShortcut.unregisterAll()
    writeLog('exited ui')
  })
  ipcMain.on('siyuan-init', async () => {
    mainWindow.webContents.send('siyuan-update-theme', {
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      init: true,
    })
    await fetch(getServer() + '/api/system/uiproc?pid=' + process.pid,
      {method: 'POST'})
  })
  ipcMain.on('siyuan-hotkey', (event, hotkey) => {
    globalShortcut.unregisterAll()
    if (!hotkey) {
      return
    }
    globalShortcut.register(hotkey, () => {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
        if (!mainWindow.isVisible()) {
          mainWindow.show()
        }
      } else {
        if (mainWindow.isVisible()) {
          if (!mainWindow.isFocused()) {
            mainWindow.show()
          } else {
            mainWindow.hide()
          }
        } else {
          mainWindow.show()
        }
      }
    })
  })

  if ('win32' === process.platform || 'linux' === process.platform) {
    // 系统托盘
    tray = new Tray(path.join(appDir, 'stage', 'icon-large.png'))
    tray.setToolTip('SiYuan v' + appVer)
    const trayMenuTemplate = [
      {
        label: 'Show Window',
        click: () => {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
        },
      },
      {
        label: 'Hide Window',
        click: () => {
          mainWindow.hide()
        },
      },
      {
        label: 'Official Website',
        click: () => {
          shell.openExternal('https://b3log.org/siyuan/')
        },
      },
      {
        label: 'Open Source',
        click: () => {
          shell.openExternal('https://github.com/siyuan-note/siyuan')
        },
      },
      {
        label: '中文反馈',
        click: () => {
          shell.openExternal('https://ld246.com/article/1649901726096')
        },
      },
      {
        label: 'Reset Window on restart',
        type: 'checkbox',
        click: v => {
          resetWindowStateOnRestart = v.checked
        },
      },
      {
        label: 'Quit',
        click: () => {
          mainWindow.webContents.send('siyuan-save-close', true)
        },
      }]
    const contextMenu = Menu.buildFromTemplate(trayMenuTemplate)
    tray.setContextMenu(contextMenu)
    tray.on('click', () => {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
        if (!mainWindow.isVisible()) {
          mainWindow.show()
        }
      } else {
        if (mainWindow.isVisible()) {
          if (!mainWindow.isFocused()) {
            mainWindow.show()
          } else {
            mainWindow.hide()
          }
        } else {
          mainWindow.show()
        }
      }
    })
  }
}

const initKernel = (initData) => {
  return new Promise(async (resolve) => {
    bootWindow = new BrowserWindow({
      width: screen.getPrimaryDisplay().size.width / 2,
      height: screen.getPrimaryDisplay().workAreaSize.height / 2,
      frame: false,
      icon: path.join(appDir, 'stage', 'icon-large.png'),
      transparent: 'linux' !== process.platform,
      webPreferences: {
        nativeWindowOpen: true,
      },
    })

    const kernelName = 'win32' === process.platform
      ? 'SiYuan-Kernel.exe'
      : 'SiYuan-Kernel'
    const kernelPath = path.join(appDir, 'kernel', kernelName)
    if (!fs.existsSync(kernelPath)) {
      showErrorWindow('⚠️ 内核文件丢失 Kernel is missing',
        `<div>内核可执行文件丢失，请重新安装思源，并将思源加入杀毒软件信任列表。</div><div>The kernel binary is not found, please reinstall SiYuan and add SiYuan into the trust list of your antivirus software.</div>`)
      bootWindow.destroy()
      resolve(false)
      return
    }

    const cmds = ['--wd', appDir]
    if (isDevEnv) {
      cmds.push('--mode', 'dev')
    }
    if (initData) {
      const initDatas = initData.split('-')
      cmds.push('--workspace', initDatas[0])
      cmds.push('--lang', initDatas[1])
    }
    let cmd = `ui version [${appVer}], booting kernel [${kernelPath} ${cmds.join(' ')}]`
    writeLog(cmd)
    let kernelProcessPid = ""
    if (!isDevEnv) {
      const cp = require('child_process')
      const kernelProcess = cp.spawn(kernelPath,
        cmds, {
          detached: false, // 桌面端内核进程不再以游离模式拉起 https://github.com/siyuan-note/siyuan/issues/6336
          stdio: 'ignore',
        },
      )
      kernelProcessPid = kernelProcess.pid
      writeLog('booted kernel process [pid=' + kernelProcessPid + ']')

      kernelProcess.on('close', (code) => {
        writeLog(`kernel exited with code [${code}]`)
        if (0 !== code) {
          switch (code) {
            case 20:
              showErrorWindow('⚠️ 数据库被锁定 The database is locked',
                `<div>数据库文件正在被其他程序锁定。如果你使用了第三方同步盘，请在思源运行期间关闭同步。</div><div>The database file is being locked by another program. If you use a third-party sync disk, please turn off sync while SiYuan is running.</div>`)
              break
            case 21:
              showErrorWindow('⚠️ 监听端口 ' + kernelPort + ' 失败 Failed to listen to port ' + kernelPort,
                '<div>监听 ' + kernelPort + ' 端口失败，请确保程序拥有网络权限并不受防火墙和杀毒软件阻止。</div><div>Failed to listen to port ' + kernelPort + ', please make sure the program has network permissions and is not blocked by firewalls and antivirus software.</div>')
              break
            case 22:
              showErrorWindow(
                '⚠️ 创建配置目录失败 Failed to create config directory',
                `<div>思源需要在用户家目录下创建配置文件夹（~/.config/siyuan），请确保该路径具有写入权限。</div><div>SiYuan needs to create a configuration folder (~/.config/siyuan) in the user\'s home directory. Please make sure that the path has write permissions.</div>`)
              break
            case 23:
              showErrorWindow(
                '⚠️ 无法读写块树文件 Failed to access blocktree file',
                `<div>块树文件正在被其他程序锁定或者已经损坏，请删除 工作空间/temp/ 文件夹后重启</div><div>The block tree file is being locked by another program or is corrupted, please delete the workspace/temp/ folder and restart.</div>`)
              break
            case 0:
            case 1: // Fatal error
              break
            default:
              showErrorWindow(
                '⚠️ 内核因未知原因退出 The kernel exited for unknown reasons',
                `<div>思源内核因未知原因退出 [code=${code}]，请尝试重启操作系统后再启动思源。如果该问题依然发生，请检查杀毒软件是否阻止思源内核启动。</div>
<div>SiYuan Kernel exited for unknown reasons [code=${code}], please try to reboot your operating system and then start SiYuan again. If occurs this problem still, please check your anti-virus software whether kill the SiYuan Kernel.</div>`)
              break
          }

          bootWindow.destroy()
          resolve(false)
        }
      })
    }

    const sleep = (ms) => {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    const getKernelPort = async () => {
      if (isDevEnv) {
        return kernelPort
      }

      await sleep(200)
      let gotPort = false
      let count = 0
      while (!gotPort) {
        try {
          const portJSON = JSON.parse(fs.readFileSync(portJSONPath, 'utf8'))
          const ret = portJSON[kernelProcessPid]
          if (ret) {
            gotPort = true
            return ret
          }
          await sleep(100)
        } catch (e) {
          await sleep(100)
        } finally {
          count++
          if (64 < count) {
            writeLog('get kernel port failed [pid=' + kernelProcessPid + ']')
            bootWindow.destroy()
            resolve(false)
          }
        }
      }
    }

    kernelPort = await getKernelPort()
    writeLog("got kernel port [" + kernelPort + "]")

    let gotVersion = false
    let apiData
    let count = 0
    writeLog('checking kernel version')
    while (!gotVersion) {
      try {
        const apiResult = await fetch(getServer() + '/api/system/version')
        apiData = await apiResult.json()
        gotVersion = true
        bootWindow.setResizable(false)
        bootWindow.loadURL(getServer() + '/appearance/boot/index.html')
        bootWindow.show()
      } catch (e) {
        writeLog('get kernel version failed: ' + e.message)
        await sleep(100)
      } finally {
        count++
        if (14 < count) {
          writeLog('get kernel ver failed')
          bootWindow.destroy()
          resolve(false)
        }
      }
    }

    if (0 === apiData.code) {
      writeLog('got kernel version [' + apiData.data + ']')
      if (!isDevEnv && apiData.data !== appVer) {
        writeLog(
          `kernel [${apiData.data}] is running, shutdown it now and then start kernel [${appVer}]`)
        fetch(getServer() + '/api/system/exit', {method: 'POST'})
        bootWindow.destroy()
        resolve(false)
      } else {
        let progressing = false
        while (!progressing) {
          try {
            const progressResult = await fetch(getServer() + '/api/system/bootProgress')
            const progressData = await progressResult.json()
            if (progressData.data.progress >= 100) {
              resolve(true)
              progressing = true
            } else {
              await sleep(100)
            }
          } catch (e) {
            writeLog('get boot progress failed: ' + e.message)
            fetch(getServer() + '/api/system/exit', {method: 'POST'})
            bootWindow.destroy()
            resolve(false)
            progressing = true
          }
        }
      }
    } else {
      writeLog(`get kernel version failed: ${apiData.code}, ${apiData.msg}`)
      resolve(false)
    }
  })
}

app.setAsDefaultProtocolClient('siyuan')

app.commandLine.appendSwitch('disable-web-security')
app.commandLine.appendSwitch('auto-detect', 'false')
app.commandLine.appendSwitch('no-proxy-server')
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

app.setPath('userData', app.getPath('userData') + '-Electron') // `~/.config` 下 Electron 相关文件夹名称改为 `SiYuan-Electron` https://github.com/siyuan-note/siyuan/issues/3349

app.whenReady().then(() => {
  ipcMain.on('siyuan-first-quit', () => {
    app.exit()
  })

  if (firstOpen) {
    firstOpenWindow = new BrowserWindow({
      width: screen.getPrimaryDisplay().size.width / 2,
      height: screen.getPrimaryDisplay().workAreaSize.height / 2,
      frame: false,
      icon: path.join(appDir, 'stage', 'icon-large.png'),
      transparent: 'linux' !== process.platform,
      webPreferences: {
        nativeWindowOpen: true,
        nodeIntegration: true,
        webviewTag: true,
        webSecurity: false,
        contextIsolation: false,
      },
    })
    require('@electron/remote/main').enable(firstOpenWindow.webContents)
    let initHTMLPath = path.join(appDir, 'app', 'electron', 'init.html')
    if (isDevEnv) {
      initHTMLPath = path.join(appDir, 'electron', 'init.html')
    }
    firstOpenWindow.loadFile(
      initHTMLPath, {
        query: {
          home: app.getPath('home'),
          v: appVer,
          icon: path.join(appDir, 'stage', 'icon-large.png'),
        },
      })
    firstOpenWindow.show()
    // 初始化启动
    ipcMain.on('siyuan-first-init', (event, initData) => {
      initKernel(initData).then((isSucc) => {
        if (isSucc) {
          boot()
        }
      })
      firstOpenWindow.destroy()
    })
  } else {
    initKernel().then((isSucc) => {
      if (isSucc) {
        boot()
      }
    })
  }
})

app.on('open-url', (event, url) => { // for macOS
  if (url.startsWith('siyuan://')) {
    siyuanOpenURL = url
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      mainWindow.webContents.send('siyuan-openurl', url)
    }
  }
})

app.on('second-instance', (event, commandLine) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focus()
    mainWindow.webContents.send('siyuan-openurl',
      commandLine.find((arg) => arg.startsWith('siyuan://')))
  }
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    boot()
  }
})

// 在编辑器内打开链接的处理，比如 iframe 上的打开链接。
app.on('web-contents-created', (webContentsCreatedEvent, contents) => {
  contents.on('new-window', (newWindowEvent, url) => {
    newWindowEvent.preventDefault()
    shell.openExternal(url)
  })
})

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault()
    mainWindow.webContents.send('siyuan-save-close', true)
  }
})

const {powerMonitor} = require('electron')
const cp = require("child_process");

powerMonitor.on('suspend', () => {
  writeLog('system suspend')
  fetch(getServer() + '/api/sync/performSync', {method: 'POST'})
})

powerMonitor.on('resume', () => {
  writeLog('system resume')
  fetch(getServer() + '/api/sync/performSync', {method: 'POST'})
})

powerMonitor.on('shutdown', () => {
  writeLog('system shutdown')
  fetch(getServer() + '/api/system/exit', {method: 'POST'})
})
