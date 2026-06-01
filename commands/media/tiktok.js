if (buttonType === 'ttvideo') {
  await sock.sendMessage(from, {
    video: { url: videoUrl },
    mimetype: 'video/mp4',
    caption,
  }, { quoted: messageData });

} else if (buttonType === 'ttvideodoc') {
  await sock.sendMessage(from, {
    document: { url: videoUrl },
    mimetype: 'video/mp4',
    fileName: `${cleanTitle}.mp4`,
    caption,
  }, { quoted: messageData });
}
