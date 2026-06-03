// commands/screenshotvideo.js
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');

module.exports = {
  name: 'screenshotvideo',
  aliases: ['webvid', 'pagevideo', 'svid'],
  category: 'tools',
  description: 'Records a short scrolling video of a webpage and sends it.',

  async execute(sock, msg, args, extra) {
    const from = extra.from;

    // ── Validate URL ──────────────────────────────────────────────
    const rawUrl = args[0];
    if (!rawUrl) {
      return sock.sendMessage(from, {
        text: `◆ *Screenshot Video*\n\n◇ Usage: .screenshotvideo <url>\n◇ Example: .screenshotvideo https://example.com`,
      }, { quoted: msg });
    }

    let url;
    try {
      url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).href;
    } catch {
      return sock.sendMessage(from, {
        text: `✦ Invalid URL provided. Please include a full address.\n◇ Example: .screenshotvideo https://example.com`,
      }, { quoted: msg });
    }

    // ── Notify user ───────────────────────────────────────────────
    await sock.sendMessage(from, {
      text: `◆ *Screenshot Video*\n\n☆ Capturing: ${url}\n◇ Please wait, this may take ~15 seconds...`,
    }, { quoted: msg });

    // ── Setup temp directory ──────────────────────────────────────
    const sessionId = Date.now();
    const frameDir = path.join(tmpdir(), `svid_${sessionId}`);
    const outputPath = path.join(tmpdir(), `svid_${sessionId}.mp4`);
    fs.mkdirSync(frameDir, { recursive: true });

    let browser;
    try {
      // ── Launch Puppeteer ──────────────────────────────────────
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // ── Load page ─────────────────────────────────────────────
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1500)); // let lazy assets load

      // ── Get scroll height ─────────────────────────────────────
      const totalHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewHeight = 720;

      // ── Capture frames (scroll + screenshot loop) ─────────────
      // ~25 frames per second, 6 seconds = 150 frames
      const FPS = 25;
      const DURATION_S = 6;
      const TOTAL_FRAMES = FPS * DURATION_S;
      const scrollStep = Math.max(1, (totalHeight - viewHeight) / TOTAL_FRAMES);

      for (let i = 0; i < TOTAL_FRAMES; i++) {
        const scrollY = Math.min(i * scrollStep, totalHeight - viewHeight);
        await page.evaluate(y => window.scrollTo(0, y), scrollY);

        // Small delay for smooth scroll rendering
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 20));

        const framePath = path.join(frameDir, `frame_${String(i).padStart(4, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png' });
      }

      await browser.close();
      browser = null;

      // ── Build video with FFmpeg ───────────────────────────────
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(frameDir, 'frame_%04d.png'))
          .inputOptions([`-framerate ${FPS}`])
          .videoCodec('libx264')
          .outputOptions([
            '-pix_fmt yuv420p',
            '-preset fast',
            '-crf 28',           // quality (lower = better, larger file)
            '-movflags +faststart',
            '-vf scale=1280:720',
          ])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      // ── Read and send video ───────────────────────────────────
      const videoBuffer = fs.readFileSync(outputPath);
      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);

      await sock.sendMessage(from, {
        video: videoBuffer,
        mimetype: 'video/mp4',
        caption: `◆ *Screenshot Video*\n\n☆ ${url}\n◇ Duration: ${DURATION_S}s  ◇ Size: ${fileSizeMB} MB`,
        gifPlayback: false,
      }, { quoted: msg });

    } catch (err) {
      console.error('[screenshotvideo] Error:', err.message);

      // Close browser if still open
      if (browser) {
        try { await browser.close(); } catch {}
      }

      // Friendly error messages
      let errMsg = '✦ Failed to capture the page.';
      if (err.message.includes('timeout')) {
        errMsg = '✦ Page took too long to load. Try a simpler URL.';
      } else if (err.message.includes('net::ERR')) {
        errMsg = '✦ Could not reach that URL. Check the address and try again.';
      } else if (err.message.includes('ffmpeg')) {
        errMsg = '✦ Video encoding failed. Make sure ffmpeg is installed on the server.';
      }

      await sock.sendMessage(from, { text: errMsg }, { quoted: msg });

    } finally {
      // ── Cleanup temp files ────────────────────────────────────
      try {
        fs.rmSync(frameDir, { recursive: true, force: true });
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}
    }
  },
};
