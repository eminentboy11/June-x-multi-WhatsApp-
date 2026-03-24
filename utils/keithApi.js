const axios = require('axios');

const BASE = 'https://apiskeith.top';

async function keithApi(endpoint, params = {}) {
  const url = `${BASE}${endpoint}`;
  const { data } = await axios.get(url, { params, timeout: 30000 });
  if (data && data.status === false) throw new Error(data.message || 'API returned error');
  return data;
}

async function keithApiBuffer(endpoint, params = {}) {
  const url = `${BASE}${endpoint}`;
  const { data } = await axios.get(url, { params, timeout: 60000, responseType: 'arraybuffer' });
  return Buffer.from(data);
}

module.exports = { keithApi, keithApiBuffer, BASE };
