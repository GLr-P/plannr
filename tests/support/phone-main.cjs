// A phone-sized browser window for end-to-end tests of the phone web app (Electron is Chromium).
const { app, BrowserWindow } = require('electron')

app.setPath('userData', process.env.PHONE_PROFILE)
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 390, height: 844, webPreferences: { sandbox: true, contextIsolation: true } })
  win.webContents.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  )
  void win.loadURL(process.env.PHONE_URL)
})
app.on('window-all-closed', () => app.quit())
