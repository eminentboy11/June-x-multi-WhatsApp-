/**
 * utils/kvstore.js
 * Thin wrapper around the kv_store SQLite table in database.js.
 * Used by antidelete, antiedit, antideletestatus, antibot (antiall), etc.
 *
 * API:
 *   kvstore.get(namespace, key, fallback?)  → parsed value or fallback
 *   kvstore.set(namespace, key, value)      → true
 *   kvstore.del(namespace, key)             → true
 *   kvstore.getAll(namespace)               → { key: value, … }
 */

'use strict';

const { getKV, setKV, delKV, getAllKV } = require('../database');

module.exports = {
  get:    (ns, key, fallback = null) => getKV(ns, key, fallback),
  set:    (ns, key, value)           => setKV(ns, key, value),
  del:    (ns, key)                  => delKV(ns, key),
  getAll: (ns)                       => getAllKV(ns),
};
