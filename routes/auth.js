import express from 'express';
import crypto from 'crypto';
import pkg from 'pg';

const { Pool } = pkg;
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ─────────────────────────────────────────────
// SEND OTP
// Frontend sends:
// { number, mode }
// ─────────────────────────────────────────────
router.post('/send-code', async (req, res) => {
  // Support both the new frontend name and old backend name
  const phone = req.body.number || req.body.phone;

  if (!phone) {
    return res.status(400).json({
      error: 'Phone number required',
    });
  }

  try {
    const normalizedPhone = String(phone).replace(/\D/g, '');

    if (normalizedPhone.length < 8 || normalizedPhone.length > 15) {
      return res.status(400).json({
        error: 'Invalid phone number',
      });
    }

    // Generate 6-digit OTP
    const code = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    const codeHash = crypto
      .createHash('sha256')
      .update(code)
      .digest('hex');

    const expiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    );

    // Remove previous challenges for this number
    await pool.query(
      'DELETE FROM auth_challenges WHERE phone = $1',
      [normalizedPhone]
    );

    await pool.query(
      `INSERT INTO auth_challenges
       (phone, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [normalizedPhone, codeHash, expiresAt]
    );

    /*
      DEVELOPMENT ONLY

      For now we return the OTP so you can test the app
      without an SMS provider.

      BEFORE PUBLIC PRODUCTION:
      - Remove "code" from this response
      - Send the code through Termii / Africa's Talking
    */

    console.log(
      `[KITE AUTH] OTP for ${normalizedPhone}: ${code}`
    );

    res.json({
      message: 'Code sent',
      pin_id: normalizedPhone,
      code,
    });

  } catch (err) {
    console.error('[AUTH SEND CODE]', err);

    res.status(500).json({
      error: 'Unable to send verification code',
    });
  }
});


// ─────────────────────────────────────────────
// VERIFY OTP
//
// Frontend sends:
// {
//   number,
//   name,
//   mode,
//   pin_id,
//   pin
// }
//
// Older clients may send:
// {
//   phone,
//   code,
//   username,
//   displayName
// }
// ─────────────────────────────────────────────
router.post('/verify-code', async (req, res) => {
  const phone =
    req.body.number ||
    req.body.phone;

  const code =
    req.body.pin ||
    req.body.code;

  const displayName =
    req.body.name ||
    req.body.displayName ||
    'User';

  const username =
    req.body.username ||
    phone;

  if (!phone || !code) {
    return res.status(400).json({
      error: 'Phone number and verification code required',
    });
  }

  try {
    const normalizedPhone = String(phone).replace(/\D/g, '');
    const normalizedCode = String(code).trim();

    if (
      normalizedPhone.length < 8 ||
      normalizedPhone.length > 15
    ) {
      return res.status(400).json({
        error: 'Invalid phone number',
      });
    }

    if (!/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({
        error: 'Verification code must be 6 digits',
      });
    }

    const codeHash = crypto
      .createHash('sha256')
      .update(normalizedCode)
      .digest('hex');

    // Find valid challenge
    const challenge = await pool.query(
      `SELECT *
       FROM auth_challenges
       WHERE phone = $1
       AND code_hash = $2
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedPhone, codeHash]
    );

    if (challenge.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid or expired code',
      });
    }

    // Find existing user
    let user = await pool.query(
      'SELECT * FROM users WHERE phone = $1',
      [normalizedPhone]
    );

    // Create account if it doesn't exist
    if (user.rows.length === 0) {
      user = await pool.query(
        `INSERT INTO users
         (phone, username, display_name)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [
          normalizedPhone,
          username,
          displayName,
        ]
      );
    } else if (
      displayName &&
      displayName !== 'User'
    ) {
      // Update display name when registering
      user = await pool.query(
        `UPDATE users
         SET display_name = $1
         WHERE phone = $2
         RETURNING *`,
        [
          displayName,
          normalizedPhone,
        ]
      );
    }

    const userId = user.rows[0].id;

    // Generate session token
    const token = crypto
      .randomBytes(32)
      .toString('hex');

    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const sessionExpiresAt = new Date(
      Date.now() +
      30 * 24 * 60 * 60 * 1000
    );

    await pool.query(
      `INSERT INTO sessions
       (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [
        userId,
        tokenHash,
        sessionExpiresAt,
      ]
    );

    // OTP is one-time use
    await pool.query(
      'DELETE FROM auth_challenges WHERE phone = $1',
      [normalizedPhone]
    );

    res.json({
      message: 'Verified',

      user: user.rows[0],

      token,

      expiresAt: sessionExpiresAt.toISOString(),
    });

  } catch (err) {
    console.error('[AUTH VERIFY CODE]', err);

    res.status(500).json({
      error: 'Unable to verify code',
    });
  }
});


export default router;
