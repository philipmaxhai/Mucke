// Mucke desktop (Windows): the same web app in an Electron window, plus per-app audio recording
// through the native mucke-loopback helper (WASAPI process loopback).
const { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session, shell } = require('electron')
const { pathToFileURL } = require('node:url')
const { execFile, spawn } = require('node:child_process')
const path = require('node:path')

const HELPER = app.isPackaged
  ? path.join(process.resourcesPath, 'mucke-loopback.exe')
  : path.join(__dirname, 'native', 'mucke-loopback.exe')

const FRIENDLY = {
  'spotify.exe': 'Spotify',
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox',
  'brave.exe': 'Brave',
  'opera.exe': 'Opera',
  'discord.exe': 'Discord',
  'vlc.exe': 'VLC',
  'teams.exe': 'Teams',
  'ms-teams.exe': 'Teams',
  'zoom.exe': 'Zoom',
  'steam.exe': 'Steam',
  'applemusic.exe': 'Apple Music',
  'itunes.exe': 'iTunes',
  'deezer.exe': 'Deezer',
  'tidal.exe': 'TIDAL',
  'soundcloud.exe': 'SoundCloud',
  'systemsounds': 'Systemsounds',
}

// Serve the built web app from app://mucke/ so module workers and AudioWorklets behave like on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

let win = null
const captures = new Map()
let nextId = 1

function ownPids() {
  return new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)])
}

function runHelper(args) {
  return new Promise((resolve, reject) => {
    execFile(HELPER, args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr?.trim() || err.message))
      resolve(stdout)
    })
  })
}

ipcMain.handle('loopback:list', async () => {
  const own = ownPids()
  const list = JSON.parse(await runHelper(['list']))
  return list
    .filter((a) => !own.has(a.pid))
    .map((a) => ({ ...a, label: FRIENDLY[a.name.toLowerCase()] ?? a.name.replace(/\.exe$/i, '') }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label))
})

ipcMain.handle('loopback:mute', async (_e, pid, mute) => {
  await runHelper(['mute', String(pid), mute ? '1' : '0'])
  return true
})

// mode 'include': only this app; mode 'exclude': whole desktop except this app (pid = Mucke itself by default)
ipcMain.handle('loopback:start', (e, { pid, mode }) => {
  const target = mode === 'exclude' && !pid ? process.pid : pid
  const id = nextId++
  const child = spawn(HELPER, ['capture', String(target), mode === 'exclude' ? 'exclude' : 'include'], { windowsHide: true })
  const sender = e.sender
  let rest = Buffer.alloc(0)
  child.stdout.on('data', (chunk) => {
    // forward whole float32 stereo frames only
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk
    const usable = buf.length - (buf.length % 8)
    rest = buf.subarray(usable)
    if (usable && !sender.isDestroyed()) sender.send('loopback:data', id, buf.subarray(0, usable))
  })
  child.stderr.on('data', (d) => {
    for (const line of String(d).split('\n').filter(Boolean)) {
      try {
        const msg = JSON.parse(line)
        if (!sender.isDestroyed()) sender.send('loopback:status', id, msg)
      } catch {
        // not a status line
      }
    }
  })
  child.on('exit', (code) => {
    captures.delete(id)
    if (!sender.isDestroyed()) sender.send('loopback:status', id, { exit: code })
  })
  captures.set(id, child)
  return { id, rate: 48000, channels: 2 }
})

ipcMain.handle('loopback:stop', (_e, id) => {
  const child = captures.get(id)
  if (!child) return false
  child.stdin.end()
  setTimeout(() => child.exitCode === null && child.kill(), 1500)
  return true
})

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: '#09090b',
    title: 'Mucke',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  if (process.env.MUCKE_DEV_URL) win.loadURL(process.env.MUCKE_DEV_URL)
  else win.loadURL('app://mucke/index.html')
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  const root = path.join(__dirname, 'app')
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.normalize(path.join(root, rel))
    if (!file.startsWith(root)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  // The web version's "Tab-Audio" button: in the desktop app it records the whole system sound (Windows loopback).
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => cb({ video: sources[0], audio: 'loopback' }))
  })
  createWindow()
})
app.on('window-all-closed', () => {
  for (const child of captures.values()) child.kill()
  app.quit()
})
