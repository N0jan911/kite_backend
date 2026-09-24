import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.post('/', async (req, res) => {
  const { userId, content, imageUrl } = req.body;
  if (!userId || !content) {
    return res.status(400).json({ error: 'userId and content required' });
  }
  try {
    const post = await pool.query(
      'INSERT INTO posts (user_id, content, image_url) VALUES ($1, $2, $3) RETURNING *',
      [userId, content, imageUrl]
    );
    res.status(201).json(post.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const posts = await pool.query(
      `SELECT p.*, u.display_name, u.avatar_url, COUNT(pl.user_id) as like_count
       FROM posts p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN post_likes pl ON p.id = pl.post_id
       GROUP BY p.id, u.id
       ORDER BY p.created_at DESC
       LIMIT 50`
    );
    res.json(posts.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:postId/like', async (req, res) => {
  const { postId } = req.params;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  try {
    const existing = await pool.query(
      'SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId]
      );
      return res.json({ message: 'Unliked' });
    }
    await pool.query(
      'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)',
      [postId, userId]
    );
    res.json({ message: 'Liked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
