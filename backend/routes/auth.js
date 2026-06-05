const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'voice2viz_jwt_secret_key_12345';

// User Registration
router.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;
  const db = req.app.get('db');

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Please provide name, email, and password.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);
  const userRole = role || 'analyst';
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    [name, email, hash, userRole, createdAt],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Email already registered.' });
        }
        return res.status(500).json({ error: err.message });
      }
      
      const token = jwt.sign({ id: this.lastID, email, role: userRole }, JWT_SECRET, { expiresIn: '24h' });
      res.status(201).json({
        token,
        user: { id: this.lastID, name, email, role: userRole }
      });
    }
  );
});

// User Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = req.app.get('db');

  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide email and password.' });
  }

  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  });
});

module.exports = router;
