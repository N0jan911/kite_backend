import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import http from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import messagesRoutes from './routes/messages.js';
import usersRoutes from './routes/users.js';
import postsRoutes from './routes/posts.js';

const { Pool } = pkg;
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST']
  },
});

const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
});
app.use(limiter);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Connected to Neon PostgreSQL');
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Kite backend is running' });
});

const userSockets = new Map();

io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  socket.on('user_login', (userId) => {
    socket.join(`user_${userId}`);
    userSockets.set(userId, socket.id);
    console.log(`📍 User ${userId} joined room: user_${userId}`);
    io.to(`user_${userId}`).emit('user_status', { status: 'online' });
  });

  socket.on('send_message', async (data) => {
    try {
      const { conversationId, senderId, content } = data;

      if (!conversationId || !senderId || !content) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      const result = await pool.query(
        'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
        [conversationId, senderId, content]
      );

      const message = result.rows[0];
      io.to(`conversation_${conversationId}`).emit('new_message', message);
      socket.emit('message_sent', message);

      console.log(`💬 Message sent in conversation ${conversationId}`);
    } catch (err) {
      console.error('Socket message error:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('join_conversation', (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    console.log(`📍 User joined conversation: ${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conversation_${conversationId}`);
    console.log(`🚪 User left conversation: ${conversationId}`);
  });

  socket.on('typing', (data) => {
    const { conversationId, userId, displayName } = data;
    io.to(`conversation_${conversationId}`).emit('user_typing', {
      userId,
      displayName,
    });
  });

  socket.on('stop_typing', (conversationId) => {
    io.to(`conversation_${conversationId}`).emit('user_stopped_typing');
  });

  socket.on('user_status', (data) => {
    const { userId, status } = data;
    io.emit('user_status_changed', { userId, status });
  });

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    pool.end();
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Kite backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 WebSocket ready for real-time messaging`);
});
