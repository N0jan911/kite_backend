import express from 'express';
import crypto from 'crypto';
import pkg from 'pg';

const { Pool } = pkg;
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Send OTP
router.post('/send-code', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await pool.query(
      'INSERT INTO auth_challenges (phone, code_hash, expires_at) VALUES ($1, $2, $3)',
      [phone, codeHash, expiresAt]
    );

    // TODO: Send SMS via Termii/Africa's Talking
    console.log(`OTP for ${phone}: ${code}`);

    res.json({ message: 'Code sent', code }); // In production, don't return code
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify OTP & create/login user
router.post('/verify-code', async (req, res) => {
  const { phone, code, username, displayName } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and code required' });
  }

  try {
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const challenge = await pool.query(
      'SELECT * FROM auth_challenges WHERE phone = $1 AND code_hash = $2 AND expires_at > NOW()',
      [phone, codeHash]
    );

    if (challenge.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    let user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);

    if (user.rows.length === 0) {
      user = await pool.query(
        'INSERT INTO users (phone, username, display_name) VALUES ($1, $2, $3) RETURNING *',
        [phone, username || phone, displayName || 'User']
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await pool.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, tokenHash, expiresAt]
    );

    await pool.query(
      'DELETE FROM auth_challenges WHERE phone = $1',
      [phone]
    );

    res.json({
      message: 'Verified',
      user: user.rows[0],
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
