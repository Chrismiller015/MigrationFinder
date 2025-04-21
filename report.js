// report.js
const fs = require('fs/promises');
const path = require('path');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const ExcelJS = require('exceljs');

// Determine a writeable user data path
let userDataPath;
try {
  // If running in main process
  userDataPath = require('electron').app.getPath('userData');
} catch {
  // Fallback in renderer or missing remote: use CWD
  userDataPath = process.cwd();
}

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'Credentials', 'gmailCredentials.json');
const DOWNLOAD_PATH = path.join(process.cwd(), 'latestReport.xlsx');
const TOKEN_PATH = path.join(userDataPath, 'token.json');

/** Load saved credentials from TOKEN_PATH, if present */
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

/** Save the refresh token back to TOKEN_PATH */
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

/** Perform OAuth, launching browser if no valid token */
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

/** Download the latest XLSX attachment to DOWNLOAD_PATH */
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
  await fs.writeFile(DOWNLOAD_PATH, buffer);
  return DOWNLOAD_PATH;
}

/** Parse the XLSX and return { headers:[], data: [...] } */
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

/**
 * Fetch, download, parse — retrying once on 401 by re-authenticating
 */
async function fetchAndParseReport() {
  try {
    const xlsx = await downloadLatestReport();
    return await parseReport(xlsx);
  } catch (err) {
    if ((err.response?.status === 401) || /Login Required/i.test(err.message)) {
      console.log('🔐  401 received—re-authenticating...');
      await fs.unlink(TOKEN_PATH).catch(() => {});
      const xlsx2 = await downloadLatestReport();
      return await parseReport(xlsx2);
    }
    throw err;
  }
}

/** Filter parsed report by BAC / DEALER NAME / ZIP */
function searchReport(parsed, { bac, dealerName, zip }) {
  return parsed.data.filter(row => {
    if (bac && row['BAC'] !== bac) return false;
    if (dealerName && !row['DEALER NAME'].toLowerCase().includes(dealerName.toLowerCase())) return false;
    if (zip && row['ZIP'] !== zip) return false;
    return true;
  });
}

module.exports = { fetchAndParseReport, searchReport };
