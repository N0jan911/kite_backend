import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create or get conversation between two users
router.post('/conversation', async (req, res) => {
  const { userId1, userId2 } = req.body;

  if (!userId1 || !userId2) {
    return res.status(400).json({ error: 'userId1 and userId2 required' });
  }

  try {
    // Check if conversation exists
    const existing = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm1 ON c.id = cm1.conversation_id
       JOIN conversation_members cm2 ON c.id = cm2.conversation_id
       WHERE (cm1.user_id = $1 AND cm2.user_id = $2)
       OR (cm1.user_id = $2 AND cm2.user_id = $1)`,
      [userId1, userId2]
    );

    if (existing.rows.length > 0) {
      return res.json({ conversationId: existing.rows[0].id });
    }

    // Create new conversation
    const conversation = await pool.query(
      'INSERT INTO conversations DEFAULT VALUES RETURNING id'
    );

    const convId = conversation.rows[0].id;

    await pool.query(
      'INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)',
      [convId, userId1, userId2]
    );

    res.status(201).json({ conversationId: convId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send message
router.post('/', async (req, res) => {
  const { conversationId, senderId, content } = req.body;

  if (!conversationId || !senderId || !content) {
    return res.status(400).json({ error: 'conversationId, senderId, and content required' });
  }

  try {
    const message = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
      [conversationId, senderId, content]
    );

    res.status(201).json(message.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get conversation messages
router.get('/:conversationId', async (req, res) => {
  const { conversationId } = req.params;

  try {
    const messages = await pool.query(
      `SELECT m.*, u.display_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    res.json(messages.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
