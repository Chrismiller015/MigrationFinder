const fs = require('fs/promises');
const path = require('path');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const ExcelJS = require('exceljs');
const Fuse = require('fuse.js'); // Using Fuse.js for fuzzy search

// Determine user data path
let userDataPath;
try {
  userDataPath = require('electron').app.getPath('userData');
} catch {
  userDataPath = process.cwd();
}

const SCOPES           = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'Credentials', 'gmailCredentials.json');
const TOKEN_PATH       = path.join(userDataPath, 'token.json');
const reportsFolder    = path.join(userDataPath, 'Reports');
const DOWNLOAD_PATH    = path.join(reportsFolder, 'latestReport.xlsx');

async function loadSavedCredentials() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
    const creds = JSON.parse(content);
    if (!creds.refresh_token) return null;
    return google.auth.fromJSON(creds);
  } catch {
    return null;
  }
}

async function saveCredentials(client) {
  const keys = JSON.parse(await fs.readFile(CREDENTIALS_PATH, 'utf8')).installed;
  const payload = {
    type: 'authorized_user',
    client_id: keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: client.credentials.refresh_token,
  };
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2));
}

async function authorize() {
  let client = await loadSavedCredentials();
  if (!client) {
    client = await authenticate({
      keyfilePath: CREDENTIALS_PATH,
      scopes: SCOPES,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
  }
  return client;
}

async function downloadLatestReport() {
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `subject:"Migration Status Report" -subject:"weekly DWC migration status Report" has:attachment filename:xlsx`,
    maxResults: 1,
  });
  if (!listRes.data.messages?.length) throw new Error('No Migration Status Report found.');
  const msgId = listRes.data.messages[0].id;

  const full = await gmail.users.messages.get({
    userId: 'me',
    id: msgId,
    format: 'full',
  });

  const parts = full.data.payload.parts || [];
  const xlsxPart = parts.find(p => p.filename?.toLowerCase().endsWith('.xlsx'));
  if (!xlsxPart) throw new Error('No XLSX attachment found on that message.');

  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: msgId,
    id: xlsxPart.body.attachmentId,
  });

  const buffer = Buffer.from(att.data.data, 'base64');
  await fs.mkdir(reportsFolder, { recursive: true });
  await fs.writeFile(DOWNLOAD_PATH, buffer);
  return DOWNLOAD_PATH;
}

async function parseReport(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];

  let headerRow;
  for (const row of sheet._rows) {
    if (row && row.values.some(v => typeof v === 'string')) {
      headerRow = row;
      break;
    }
  }
  if (!headerRow) throw new Error('No header row found.');

  const colMap = {};
  headerRow.values.forEach((val, idx) => {
    if (typeof val === 'string') {
      colMap[val.trim().toUpperCase()] = idx;
    }
  });

  const data = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === headerRow.number) return;
    const entry = {};
    for (const [hdr, col] of Object.entries(colMap)) {
      entry[hdr] = row.getCell(col).text;
    }
    data.push(entry);
  });

  return { headers: Object.keys(colMap), data };
}

async function fetchAndParseReport() {
  try {
    let fileFresh = false;
    try {
      const stats = await fs.stat(DOWNLOAD_PATH);
      const fileAge = Date.now() - stats.mtimeMs;
      if (fileAge < 60 * 60 * 1000) fileFresh = true; // < 1 hour
    } catch {
      // File missing — will trigger download
    }

    const reportPath = fileFresh ? DOWNLOAD_PATH : await downloadLatestReport();
    return await parseReport(reportPath);

  } catch (err) {
    if ((err.response?.status === 401) || /Login Required/i.test(err.message)) {
      console.log('🔐 401 received — reauthenticating...');
      await fs.unlink(TOKEN_PATH).catch(() => {});
      const newPath = await downloadLatestReport();
      return await parseReport(newPath);
    }
    throw err;
  }
}

// Updated searchReport function
function searchReport(parsed, { bac, dealerName, zip, address }) {
  let searchData = parsed.data;

  // Step 1: If an address is provided, perform a fuzzy search first.
  if (address) {
    const fuseOptions = {
      includeScore: true,
      threshold: 0.4,
      keys: [
        { name: 'ADDRESS', weight: 0.6 },
        { name: 'CITY', weight: 0.2 },
        { name: 'ZIP', weight: 0.2 }
      ]
    };

    const fuse = new Fuse(parsed.data, fuseOptions);
    searchData = fuse.search(address).map(result => result.item);
  }

  // Step 2: Filter the results by the other criteria.
  return searchData.filter(row => {
    if (bac && row['BAC'] !== bac) return false;
    if (dealerName && !row['DEALER NAME'].toLowerCase().includes(dealerName.toLowerCase())) return false;
    
    // **FIXED**: Check if the ZIP from the report starts with the entered ZIP.
    // This handles cases where the report has "12345-6789" and you search for "12345".
    if (zip && !(row['ZIP'] && row['ZIP'].startsWith(zip))) return false;
    
    return true;
  });
}

module.exports = {
  fetchAndParseReport,
  searchReport,
  DOWNLOAD_PATH 
};