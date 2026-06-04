/**
 * Weather Command - Get weather information using OpenWeather API
 */

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

module.exports = {
  name: 'weather',
  aliases: ['w', 'clima'],
  category: 'utility',
  description: 'Get weather for a city',
  usage: '.weather <city>',

  async execute(sock, msg, args, extra) {
    try {
      if (args.length === 0) {
        return extra.reply('❌ Please provide a city name!\nExample: .weather London');
      }

      const city = args.join(' ');
      const apiKey = '4902c0f2550f58298ad4146a92b65e10';

      await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

      const { data: w } = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`
      );

      // Wind direction from degrees
      const getWindDir = (deg) => {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return dirs[Math.round(deg / 45) % 8];
      };

      // Sunrise & sunset formatting
      const formatTime = (unix) => {
        const d = new Date(unix * 1000);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };

      const text =
        `┏━━『 🌤️ *WEATHER INFO* 』━━\n\n` +
        `🏙️ *City:* ${w.name}, ${w.sys.country}\n` +
        `🌍 *Coordinates:* ${w.coord.lat}°N, ${w.coord.lon}°E\n\n` +
        `┃ *Conditions*\n` +
        `☁️ *Weather:* ${w.weather[0].main}\n` +
        `📋 *Description:* ${w.weather[0].description.charAt(0).toUpperCase() + w.weather[0].description.slice(1)}\n\n` +
        `┃ *Temperature*\n` +
        `🌡️ *Temp:* ${w.main.temp}°C\n` +
        `🔥 *Feels Like:* ${w.main.feels_like}°C\n` +
        `⬆️ *Max:* ${w.main.temp_max}°C\n` +
        `⬇️ *Min:* ${w.main.temp_min}°C\n\n` +
        `┃ *Atmosphere*\n` +
        `💧 *Humidity:* ${w.main.humidity}%\n` +
        `🌬️ *Wind:* ${w.wind.speed} m/s ${getWindDir(w.wind.deg)}\n` +
        `👁️ *Visibility:* ${(w.visibility / 1000).toFixed(1)} km\n` +
        `🔵 *Pressure:* ${w.main.pressure} hPa\n\n` +
        `┃ *Sun*\n` +
        `🌅 *Sunrise:* ${formatTime(w.sys.sunrise)}\n` +
        `🌇 *Sunset:* ${formatTime(w.sys.sunset)}\n\n` +
        `┗━━━━━━━━━━━━━━━━`;

      await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

      await sendButtons(sock, extra.from, {
        text,
        footer: `> Powered by ${config.botName}`,
        buttons: [
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '🌍 Full Forecast',
              url: `https://openweathermap.org/city/${w.id}`
            })
          },
          {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
              display_text: '📋 Copy City Name',
              copy_code: `${w.name}, ${w.sys.country}`
            })
          }
        ]
      }, { quoted: msg });

    } catch (error) {
      console.error('WEATHER ERROR:', error);
      await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

      if (error.response?.status === 404) {
        await extra.reply(`❌ City *"${args.join(' ')}"* not found!\nCheck the spelling and try again.`);
      } else if (error.response?.status === 401) {
        await extra.reply('❌ Invalid API key!');
      } else {
        await extra.reply('❌ Failed to fetch weather: ' + (error.message || 'Unknown error'));
      }
    }
  }
};
