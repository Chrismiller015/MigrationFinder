// main.js
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'))
     .catch(err => console.error('❌ Failed to load index.html:', err));
}

app.whenReady()
   .then(() => {
     createWindow();

     // Only register IPC after app is fully ready
     ipcMain.handle('fetch-report', async () => {
       const { fetchAndParseReport } = require('./report.js');
       try {
         return await fetchAndParseReport();
       } catch (err) {
         throw err;
       }
     });
   })
   .catch(err => console.error('❌ App.whenReady error:', err));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
