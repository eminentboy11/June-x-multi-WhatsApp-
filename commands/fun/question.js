const axios = require('axios');

module.exports = {
  name: 'question',
  aliases: ['randomq'],
  category: 'fun',
  description: 'Get a random trivia question',
  usage: '.question',

  async execute(sock, msg, args, extra) {
    await extra.react('❓');
    try {
      const { data } = await axios.get(
        'https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986'
      );

      if (data.response_code !== 0 || !data.results?.length) {
        return extra.reply('❌ Could not fetch a question. Try again.');
      }

      const q = data.results[0];

      // Decode URL-encoded strings
      const decode = (str) => decodeURIComponent(str);

      const question  = decode(q.question);
      const category  = decode(q.category);
      const difficulty = decode(q.difficulty);
      const correct   = decode(q.correct_answer);

      // Shuffle all 4 options
      const options = [correct, ...q.incorrect_answers.map(decode)]
        .sort(() => Math.random() - 0.5);

      const labels = ['🅰️', '🅱️', '🅲️', '🅳️'];
      const optionList = options.map((opt, i) => `${labels[i]} ${opt}`).join('\n');

      // Find which label is the correct answer
      const correctLabel = labels[options.indexOf(correct)];

      const text =
        `❓ *Random Question*\n\n` +
        `📂 _${category}_ • 🔥 _${difficulty}_\n\n` +
        `*${question}*\n\n` +
        `${optionList}\n\n` +
        `||✅ Answer: ${correctLabel} ${correct}||`;

      await extra.reply(text);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
