/**
 * Document Converter Commands
 * .topdf   → Convert Word (.docx) or Excel (.xlsx) to PDF
 * .toexcel → Convert PDF to Excel (.xlsx)
 * .toword  → Convert PDF to Word (.docx)
 */

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const TEMP_DIR = path.join(os.tmpdir(), 'june-x-docconv');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── LibreOffice check ──────────────────────────────────────────────────────

async function getLibreOfficeBin() {
  const candidates = ['soffice', 'libreoffice', '/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice'];
  for (const bin of candidates) {
    try {
      await execAsync(`${bin} --version`);
      return bin;
    } catch { /* try next */ }
  }
  return null;
}

async function libreOfficeConvert(inputPath, outputDir, targetFormat) {
  const bin = await getLibreOfficeBin();
  if (!bin) return false;
  try {
    await execAsync(
      `${bin} --headless --convert-to ${targetFormat} --outdir "${outputDir}" "${inputPath}"`,
      { timeout: 60000 }
    );
    return true;
  } catch (e) {
    console.error('LibreOffice convert error:', e.message);
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function writeTmp(buffer, ext) {
  const p = path.join(TEMP_DIR, `input_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(p, buffer);
  return p;
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

async function downloadDocument(sock, msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;

  const docMsg =
    ctx.quotedMessage.documentMessage ||
    ctx.quotedMessage.documentWithCaptionMessage?.message?.documentMessage;

  if (!docMsg) return null;

  const fullQuoted = {
    key: {
      remoteJid: ctx.remoteJid || msg.key.remoteJid,
      fromMe: false,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
  };

  const buffer = await downloadMediaMessage(fullQuoted, 'buffer', {}, { logger: undefined });
  return { buffer, docMsg };
}

// ── PDF text extraction (fixed) ────────────────────────────────────────────

async function pdfToText(buffer) {
  // pdf-parse can choke on certain buffers — wrap defensively
  let pdfParse;
  try { pdfParse = require('pdf-parse'); } catch {
    throw new Error('pdf-parse is not installed. Run: npm i pdf-parse');
  }
  // Some versions need a plain Buffer, not a Uint8Array slice
  const clean = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const data = await pdfParse(clean, { version: 'v1.10.100' });
  const text = (data.text || '').trim();
  if (!text) throw new Error('No readable text found in PDF. It may be scanned/image-based.');
  return text;
}

// ── Node-only converters ───────────────────────────────────────────────────

async function textToExcel(text, outputPath) {
  let XLSX;
  try { XLSX = require('xlsx'); } catch {
    throw new Error('xlsx is not installed. Run: npm i xlsx');
  }

  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);

  const rows = lines.map(line => {
    // Split on 2+ spaces or tabs — common PDF column separator
    const cols = line.split(/\t|\s{2,}/);
    return cols.length > 1 ? cols : [line];
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Auto column width
  const colWidths = rows.reduce((acc, row) => {
    row.forEach((cell, i) => {
      acc[i] = Math.max(acc[i] || 0, String(cell || '').length);
    });
    return acc;
  }, []);
  ws['!cols'] = colWidths.map(w => ({ wch: Math.min(w + 2, 60) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, outputPath);
}

async function textToWord(text, outputPath) {
  let Document, Packer, Paragraph, TextRun;
  try {
    ({ Document, Packer, Paragraph, TextRun } = require('docx'));
  } catch {
    throw new Error('docx is not installed. Run: npm i docx');
  }

  const lines = text.split('\n').map(l => l.trim());

  const paragraphs = lines.map(line =>
    new Paragraph({
      children: [new TextRun({ text: line, size: 24, font: 'Calibri' })],
      spacing: { after: 120 },
    })
  );

  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buf);
}

async function docxToPdfNode(buffer, outputPath) {
  let mammoth, PDFDocument;
  try { mammoth = require('mammoth'); } catch {
    throw new Error('mammoth is not installed. Run: npm i mammoth');
  }
  try { PDFDocument = require('pdfkit'); } catch {
    throw new Error('pdfkit is not installed. Run: npm i pdfkit');
  }

  // mammoth accepts {buffer} directly
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value || '').trim();
  if (!text) throw new Error('No readable text found in the Word document.');

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.font('Helvetica').fontSize(11);

    const pageWidth = doc.page.width - 100; // account for margins

    text.split('\n').forEach(line => {
      const l = line.trim();
      if (l === '') {
        doc.moveDown(0.4);
      } else {
        doc.text(l, { width: pageWidth, lineGap: 3 });
      }
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function excelToPdfNode(buffer, outputPath) {
  let XLSX, PDFDocument;
  try { XLSX = require('xlsx'); } catch {
    throw new Error('xlsx is not installed. Run: npm i xlsx');
  }
  try { PDFDocument = require('pdfkit'); } catch {
    throw new Error('pdfkit is not installed. Run: npm i pdfkit');
  }

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows.length) throw new Error('Excel file appears to be empty.');

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.font('Helvetica').fontSize(9);

    const pageWidth  = doc.page.width  - 60;
    const pageHeight = doc.page.height - 60;

    // Compute column widths proportionally
    const colCount = Math.max(...rows.map(r => r.length));
    const colW = colCount > 0 ? Math.floor(pageWidth / colCount) : pageWidth;

    rows.forEach((row, ri) => {
      // New page if near bottom
      if (doc.y > pageHeight - 20) doc.addPage();

      let x = 30;
      const y = doc.y;
      let maxH = 14;

      row.forEach((cell, ci) => {
        const cellStr = String(cell ?? '');
        const h = doc.heightOfString(cellStr, { width: colW - 4 });
        maxH = Math.max(maxH, h + 4);

        // Header row bold
        if (ri === 0) doc.font('Helvetica-Bold');
        else doc.font('Helvetica');

        doc.text(cellStr, x + 2, y, { width: colW - 4, lineBreak: true });
        x += colW;
      });

      doc.y = y + maxH;
      doc.x = 30;

      // Divider under header
      if (ri === 0) {
        doc.moveTo(30, doc.y).lineTo(30 + pageWidth, doc.y).stroke();
      }
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ── Universal convert dispatcher ───────────────────────────────────────────
// Tries LibreOffice first (best quality), falls back to Node libs

async function convertWithFallback(inputExt, targetExt, buffer, outputPath, nodeConverter) {
  const inputPath = writeTmp(buffer, inputExt);
  try {
    const loSuccess = await libreOfficeConvert(inputPath, TEMP_DIR, targetExt);
    if (loSuccess) {
      // LibreOffice writes to TEMP_DIR with same base name
      const base = path.basename(inputPath, `.${inputExt}`);
      const loOut = path.join(TEMP_DIR, `${base}.${targetExt}`);
      if (fs.existsSync(loOut)) {
        fs.renameSync(loOut, outputPath);
        cleanup(inputPath);
        return;
      }
    }
    // Fallback to Node
    await nodeConverter(buffer, outputPath);
  } finally {
    cleanup(inputPath);
  }
}

// ── MIME map ───────────────────────────────────────────────────────────────

const MIME_TYPES = {
  pdf:  'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// ── Commands ───────────────────────────────────────────────────────────────

module.exports = [

  {
    name: 'toexcel',
    aliases: ['xlsx', 'pdftoexcel'],
    category: 'convert',
    description: 'Convert a PDF to Excel (.xlsx)',
    usage: '.toexcel (reply to a PDF)',

    async execute(sock, msg, args, extra) {
      const chatId = extra.from;
      const downloaded = await downloadDocument(sock, msg);
      if (!downloaded)
        return extra.reply('📎 Reply to a *PDF document* with *.toexcel*');

      const { buffer, docMsg } = downloaded;
      if (!(docMsg.mimetype || '').includes('pdf'))
        return extra.reply('❌ Only *PDF* files can be converted to Excel.');

      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });
      const outPath = path.join(TEMP_DIR, `out_${Date.now()}.xlsx`);

      try {
        const text = await pdfToText(buffer);
        await textToExcel(text, outPath);

        await sock.sendMessage(chatId, {
          document: fs.readFileSync(outPath),
          mimetype: MIME_TYPES.xlsx,
          fileName: 'converted.xlsx',
          caption: '✅ Converted to Excel.',
        }, { quoted: msg });

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      } catch (e) {
        console.error('toexcel error:', e);
        await extra.reply(`❌ Conversion failed: ${e.message}`);
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      } finally {
        cleanup(outPath);
      }
    },
  },

  {
    name: 'toword',
    aliases: ['docx2', 'pdftoword'],
    category: 'convert',
    description: 'Convert a PDF to Word (.docx)',
    usage: '.toword (reply to a PDF)',

    async execute(sock, msg, args, extra) {
      const chatId = extra.from;
      const downloaded = await downloadDocument(sock, msg);
      if (!downloaded)
        return extra.reply('📎 Reply to a *PDF document* with *.toword*');

      const { buffer, docMsg } = downloaded;
      if (!(docMsg.mimetype || '').includes('pdf'))
        return extra.reply('❌ Only *PDF* files can be converted to Word.');

      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });
      const outPath = path.join(TEMP_DIR, `out_${Date.now()}.docx`);

      try {
        const text = await pdfToText(buffer);
        await textToWord(text, outPath);

        await sock.sendMessage(chatId, {
          document: fs.readFileSync(outPath),
          mimetype: MIME_TYPES.docx,
          fileName: 'converted.docx',
          caption: '✅ Converted to Word.',
        }, { quoted: msg });

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      } catch (e) {
        console.error('toword error:', e);
        await extra.reply(`❌ Conversion failed: ${e.message}`);
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      } finally {
        cleanup(outPath);
      }
    },
  },

  {
    name: 'topdf',
    aliases: ['converttopdf', 'makepdf'],
    category: 'convert',
    description: 'Convert Word (.docx) or Excel (.xlsx) to PDF',
    usage: '.topdf (reply to a .docx or .xlsx)',

    async execute(sock, msg, args, extra) {
      const chatId = extra.from;
      const downloaded = await downloadDocument(sock, msg);
      if (!downloaded)
        return extra.reply('📎 Reply to a *Word (.docx)* or *Excel (.xlsx)* with *.topdf*');

      const { buffer, docMsg } = downloaded;
      const mime     = docMsg.mimetype || '';
      const fileName = (docMsg.fileName || '').toLowerCase();

      const isDocx = mime.includes('wordprocessingml') || mime.includes('msword')
                  || fileName.endsWith('.docx') || fileName.endsWith('.doc');
      const isXlsx = mime.includes('spreadsheetml') || mime.includes('ms-excel')
                  || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

      if (!isDocx && !isXlsx)
        return extra.reply('❌ Send a *Word (.docx)* or *Excel (.xlsx)* file.');

      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });
      const outPath = path.join(TEMP_DIR, `out_${Date.now()}.pdf`);

      try {
        if (isDocx) {
          await convertWithFallback('docx', 'pdf', buffer, outPath, docxToPdfNode);
        } else {
          await convertWithFallback('xlsx', 'pdf', buffer, outPath, excelToPdfNode);
        }

        await sock.sendMessage(chatId, {
          document: fs.readFileSync(outPath),
          mimetype: MIME_TYPES.pdf,
          fileName: 'converted.pdf',
          caption: '✅ Converted to PDF.',
        }, { quoted: msg });

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      } catch (e) {
        console.error('topdf error:', e);
        await extra.reply(`❌ Conversion failed: ${e.message}`);
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      } finally {
        cleanup(outPath);
      }
    },
  },
];
