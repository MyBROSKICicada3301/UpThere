/**
 * Electron main process.
 *
 * The renderer is served through a custom `app://` protocol instead of
 * `file://` so that module Web Workers and same-origin requests work
 * unmodified. All application logic lives in the web bundle; this process
 * only creates the window and serves `dist/`.
 */

const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'UpThere',
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadURL('app://bundle/index.html');
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.join(__dirname, '..', 'dist', decodeURIComponent(pathname));
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
