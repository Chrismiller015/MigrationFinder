const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { fetchAndParseReport, DOWNLOAD_PATH } = require('./report');
const fs = require('fs/promises');

const appVersion = require('./package.json').version;

let isSearching = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets', 'MigrationReportFinderIcon.ico') // Custom taskbar/icon
  });

  // Hide the menu bar
  win.setMenuBarVisibility(false);

  // Set the window title
  win.setTitle("Migration Finder");

  // Load the main HTML file
  win.loadFile(path.join(__dirname, 'index.html'))
    .catch(err => console.error('❌ Failed to load index.html:', err));

  // Handle close event
  win.on('close', (e) => {
    if (isSearching) {
      e.preventDefault();
      win.webContents.send('show-close-warning');
    }
  });
}

app.whenReady()
   .then(() => {
     createWindow();

     ipcMain.handle('fetch-report', async () => {
       try {
         return await fetchAndParseReport();
       } catch (err) {
         throw err;
       }
     });

     ipcMain.handle('get-app-version', async () => {
       return appVersion;
     });

     ipcMain.handle('set-searching', (event, status) => {
       isSearching = status;
     });
   })
   .catch(err => console.error('❌ App.whenReady error:', err));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 🧹 Clean up latestReport.xlsx on app exit
app.on('will-quit', async () => {
  try {
    await fs.unlink(DOWNLOAD_PATH);
    console.log('🧹 Deleted latestReport.xlsx on app exit.');
  } catch {
    // fine if it was already missing
  }
});
