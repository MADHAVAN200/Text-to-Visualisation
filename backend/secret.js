const crypto = require('node:crypto');
const configured = process.env.JWT_SECRET === 'voice2viz_jwt_secret_key_12345' ? undefined : process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !configured) throw new Error('Set JWT_SECRET before starting the server');
module.exports = configured || crypto.randomBytes(32).toString('hex');
