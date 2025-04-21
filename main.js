// main.js
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive __dirname in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    backgroundColor: '#000000',
    webPreferences: {
      // Enable Node integration in the renderer
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the index.html of the app.
  win.loadFile(path.join(__dirname, 'index.html'))
     .catch(err => console.error('❌ Failed to load index.html:', err));
}

app.whenReady()
   .then(createWindow)
   .catch(err => console.error('❌ App.whenReady error:', err));

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create a window when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
