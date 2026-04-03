/**
 * Document Converter Commands
 * .topdf   → Convert Word (.docx) or Excel (.xlsx) to PDF
 * .toexcel → Convert PDF to Excel (.xlsx)
 * .toword  → Convert PDF to Word (.docx)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const TEMP_DIR = path.join(os.tmpdir(), 'june-x-docconv');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

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

  const buffer = await downloadMediaMessage(
    fullQuoted,
    'buffer',
    {},
    { logger: undefined }
  );

  return { buffer, docMsg };
}

async function pdfToText(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return data.text || '';
}

async function textToExcel(text, outputPath) {
  const XLSX = require('xlsx');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows = lines.map((line) => {
    const cols = line.split(/\s{2,}|\t/);
    return cols.length > 1 ? cols : [line];
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, outputPath);
}

async function textToWord(text, outputPath) {
  const { Document, Packer, Paragraph, TextRun } = require('docx');
  const lines = text.split('\n').map((l) => l.trim());

  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 24 })],
        spacing: { after: 100 },
      })
  );

  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buf);
}

async function docxToPdf(buffer, outputPath) {
  const mammoth = require('mammoth');
  const PDFDocument = require('pdfkit');

  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || '';

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.fontSize(12).text(text, { lineGap: 4 });
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function excelToPdf(buffer, outputPath) {
  const XLSX = require('xlsx');
  const PDFDocument = require('pdfkit');

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, layout: 'landscape' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    doc.fontSize(11);
    rows.forEach((row) => {
      const line = (row || []).join('   |   ');
      doc.text(line, { lineGap: 3 });
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

const MIME_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

module.exports = [
  {
    name: 'toexcel',
    aliases: ['xlsx', 'pdftoexcel'],
    category: 'convert',
    description: 'Convert a PDF document to Excel (.xlsx)',
    usage: '.toexcel (reply to a PDF)',

    async execute(sock, msg, args, extra) {
      const chatId = extra.from;

      const downloaded = await downloadDocument(sock, msg);
      if (!downloaded)
        return extra.reply('📎 Reply to a *PDF document* with *.toexcel* to convert it.');

      const { buffer, docMsg } = downloaded;
      const mime = docMsg.mimetype || '';

      if (!mime.includes('pdf'))
        return extra.reply('❌ This command only converts *PDF* files to Excel.');

      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      try {
        const text = await pdfToText(buffer);
        if (!text.trim()) throw new Error('No readable text found in the PDF.');

        const outPath = path.join(TEMP_DIR, `converted_${Date.now()}.xlsx`);
        await textToExcel(text, outPath);

        await sock.sendMessage(
          chatId,
          {
            document: fs.readFileSync(outPath),
            mimetype: MIME_TYPES.xlsx,
            fileName: 'converted.xlsx',
            caption: '✅ Here is your converted Excel file.',
          },
          { quoted: msg }
        );

        fs.unlinkSync(outPath);
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      } catch (e) {
        console.error('toexcel error:', e);
        await extra.reply(`❌ Conversion failed: ${e.message}`);
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      }
    },
  },

  {
    name: 'toword',
    aliases: ['docx', 'worldpdf', 'pdftoword'],
    category: 'convert',
    description: 'Convert a PDF document to Word (.docx)',
    usage: '.toword (reply to a PDF)',

    async execute(sock, msg, args, extra) {
      const chatId = extra.from;

      const downloaded = await downloadDocument(sock, msg);
      if (!downloaded)
        return extra.reply('📎 Reply to a *PDF document* with *.toword* to convert it.');

      const { buffer, docMsg } = downloaded;
      const mime = docMsg.mimetype || '';

      if (!mime.includes('pdf'))
        return extra.reply('❌ This command only converts *PDF* files to Word.');

      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      try {
        const text = await pdfToText(buffer);
        if (!text.trim()) throw new Error('No readable text found in the PDF.');

        const outPath = path.join(TEMP_DIR, `converted_${Date.now()}.docx`);
        await textToWord(text, outPath);

        await sock.sendMessage(
          chatId,
          {
            document: fs.readFileSync(outPath),
            mimetype: MIME_TYPES.docx,
            fileName: 'converted.docx',
            caption: '✅ Here is your converted Word document.',
          },
          { quoted: msg }
        );

        fs.unlinkSync(outPath);
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      } catch (e) {
        console.error('toword error:', e);
        await extra.reply(`❌ Conversion failed: ${e.message}`);
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      }
    },
  },

  {
    name: 'topdf',
    aliases: ['converttopdf', 'makepdf'],
    category: 'convert',
    description: 'Convert a Word (.docx) or Excel (.xlsx) file to PDF',
    usage: '.topdf (reply to a .docx or .xlsx document)',

    async execute(sock, msg, args, extra) {
      const chatId = extra.from;

      const downloaded = await downloadDocument(sock, msg);
      if (!downloaded)
        return extra.reply(
          '📎 Reply to a *Word (.docx)* or *Excel (.xlsx)* document with *.topdf* to convert it.'
        );

      const { buffer, docMsg } = downloaded;
      const mime = docMsg.mimetype || '';
      const fileName = (docMsg.fileName || '').toLowerCase();

      const isDocx =
        mime.includes('wordprocessingml') ||
        mime.includes('msword') ||
        fileName.endsWith('.docx') ||
        fileName.endsWith('.doc');

      const isXlsx =
        mime.includes('spreadsheetml') ||
        mime.includes('ms-excel') ||
        fileName.endsWith('.xlsx') ||
        fileName.endsWith('.xls');

      if (!isDocx && !isXlsx)
        return extra.reply('❌ Send a *Word (.docx)* or *Excel (.xlsx)* file. PDFs and other formats are not supported.');

      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      try {
        const outPath = path.join(TEMP_DIR, `converted_${Date.now()}.pdf`);

        if (isDocx) {
          await docxToPdf(buffer, outPath);
        } else {
          await excelToPdf(buffer, outPath);
        }

        await sock.sendMessage(
          chatId,
          {
            document: fs.readFileSync(outPath),
            mimetype: MIME_TYPES.pdf,
            fileName: 'converted.pdf',
            caption: '✅ Here is your converted PDF.',
          },
          { quoted: msg }
        );

        fs.unlinkSync(outPath);
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      } catch (e) {
        console.error('topdf error:', e);
        await extra.reply(`❌ Conversion failed: ${e.message}`);
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      }
    },
  },
];
