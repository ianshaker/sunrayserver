// Читаем sample rate из первого MPEG-фрейма MP3 (без ffmpeg).
// Неверный sampleRateHertz в Google STT → обрезанная/битая расшифровка.
function detectMp3SampleRate(buffer) {
  const ratesMpeg1 = [44100, 48000, 32000, null];
  const ratesMpeg2 = [22050, 24000, 16000, null];
  const ratesMpeg25 = [11025, 12000, 8000, null];

  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;

    const version = (buffer[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layer = (buffer[i + 1] >> 1) & 0x03; // 1=Layer III
    if (layer !== 1) continue;

    const srIndex = (buffer[i + 2] >> 2) & 0x03;
    if (srIndex === 3) continue;

    if (version === 3) return ratesMpeg1[srIndex];
    if (version === 2) return ratesMpeg2[srIndex];
    if (version === 0) return ratesMpeg25[srIndex];
  }

  return null;
}

module.exports = { detectMp3SampleRate };
