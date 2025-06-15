const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

// Security configuration
const { rateLimitConfig, corsConfig, helmetConfig, helmet } = require('./config/security');

const app = express();
const server = http.createServer(app);

// Determine if we're in production
const isProduction = process.env.NODE_ENV === 'production';

const io = socketIo(server, {
  cors: corsConfig,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Security Middleware
app.use(helmet(helmetConfig));
app.use(rateLimitConfig);
app.use(compression());

// Logging
if (isProduction) {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// CORS and body parsing
app.use(cors(corsConfig));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Images are now served from Cloudinary, no need for local static serving
// app.use('/img_libs', express.static(path.join(__dirname, 'img_libs'))); // Removed - using Cloudinary

// MongoDB Connection with better error handling
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is not set!');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('🍃 MongoDB Atlas connected successfully!');
  if (!isProduction) {
    console.log('🔗 Database:', MONGODB_URI.replace(/\/\/.*@/, '//***:***@'));
  }
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Graceful shutdown initiated...');
  
  // Close database connection
  await mongoose.connection.close();
  console.log('📦 Database connection closed');
  
  // Close server
  server.close(() => {
    console.log('🔌 HTTP server closed');
    process.exit(0);
  });
});

// Global error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Models
const Room = require('./models/Room');
const Player = require('./models/Player');
const MemeTemplate = require('./models/MemeTemplate');
const Caption = require('./models/Caption');

// Game state management
const gameRooms = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  const fs = require('fs');
  const publicExists = fs.existsSync(path.join(__dirname, 'public'));
  const indexExists = fs.existsSync(path.join(__dirname, 'public', 'index.html'));
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    debug: {
      __dirname: __dirname,
      publicExists: publicExists,
      indexExists: indexExists,
      publicPath: path.join(__dirname, 'public'),
      indexPath: path.join(__dirname, 'public', 'index.html')
    }
  });
});

// Routes
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  console.log('🔍 Looking for index.html at:', filePath);
  res.sendFile(filePath);
});

app.get('/game/:roomId', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'game.html');
  console.log('🔍 Looking for game.html at:', filePath);
  res.sendFile(filePath);
});

// API Routes with input validation
const { body, param, validationResult } = require('express-validator');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: errors.array() 
    });
  }
  next();
};

app.post('/api/create-room', 
  [
    body('playerName')
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage('Player name must be between 2 and 20 characters')
      .matches(/^[a-zA-Z0-9\u00C0-\u017F\u1EA0-\u1EF9\s]+$/)
      .withMessage('Player name contains invalid characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { playerName } = req.body;
      const roomId = generateRoomId();
      
      // Create room object
      const roomData = {
        roomId,
        players: [{
          socketId: null,
          name: playerName.trim(),
          isHost: true,
          score: 0,
          cards: []
        }],
        status: 'waiting',
        currentJudge: 0,
        currentCaption: null,
        createdAt: new Date()
      };
      
      // Store in memory first for immediate access
      gameRooms.set(roomId, roomData);
      
      // Then save to database
      try {
        const room = new Room(roomData);
        await room.save();
        console.log(`💾 Room ${roomId} saved to database via API`);
      } catch (dbError) {
        console.error(`❌ Database save failed for room ${roomId}:`, dbError);
        // Room still exists in memory, continue
      }
      
      res.json({ roomId, success: true });
      console.log(`🏠 Room ${roomId} created via API by ${playerName}`);
    } catch (error) {
      console.error('❌ Create room API error:', error);
      res.status(500).json({ error: 'Failed to create room' });
    }
  }
);

app.post('/api/join-room',
  [
    body('playerName')
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage('Player name must be between 2 and 20 characters')
      .matches(/^[a-zA-Z0-9\u00C0-\u017F\u1EA0-\u1EF9\s]+$/)
      .withMessage('Player name contains invalid characters'),
    body('roomId')
      .trim()
      .isLength({ min: 6, max: 6 })
      .withMessage('Room ID must be exactly 6 characters')
      .isAlphanumeric()
      .withMessage('Room ID must contain only letters and numbers')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { roomId, playerName } = req.body;
      let room = gameRooms.get(roomId);
      
      if (!room) {
        const dbRoom = await Room.findOne({ roomId });
        if (!dbRoom) {
          return res.status(404).json({ error: 'Room not found' });
        }
        room = dbRoom;
        gameRooms.set(roomId, room);
      }
      
      // Check if player already exists (avoid duplicates)
      const existingPlayer = room.players.find(p => p.name === playerName.trim());
      if (existingPlayer) {
        return res.status(400).json({ error: 'Player name already taken in this room' });
      }
      
      if (room.players.length >= 8) {
        return res.status(400).json({ error: 'Room is full' });
      }
      
      const newPlayer = {
        socketId: null,
        name: playerName.trim(),
        isHost: false,
        score: 0,
        cards: []
      };
      
      room.players.push(newPlayer);
      
      try {
        await Room.updateOne({ roomId }, { players: room.players });
        console.log(`💾 Room ${roomId} updated in database via API`);
      } catch (dbError) {
        console.error(`❌ Database update failed for room ${roomId}:`, dbError);
      }
      
      res.json({ success: true, players: room.players });
      console.log(`👋 ${playerName} joined room ${roomId} via API`);
    } catch (error) {
      console.error('❌ Join room API error:', error);
      res.status(500).json({ error: 'Failed to join room' });
    }
  }
);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🎮 Player connected:', socket.id);

  // Create room
  socket.on('createRoom', async (playerName) => {
    try {
      const roomId = generateRoomId();
      
      // Create room object
      const roomData = {
        roomId,
        players: [{
          socketId: socket.id,
          name: playerName,
          isHost: true,
          score: 0,
          cards: []
        }],
        status: 'waiting',
        currentJudge: 0,
        currentCaption: null
      };
      
      // Store in memory first for immediate access
      gameRooms.set(roomId, roomData);
      
      // Then save to database
      try {
        const room = new Room(roomData);
        await room.save();
        console.log(`💾 Room ${roomId} saved to database`);
      } catch (dbError) {
        console.error(`❌ Database save failed for room ${roomId}:`, dbError);
        // Room still exists in memory, continue
      }
      
      socket.join(roomId);
      
      // Store room info on socket for tracking
      socket.currentRoom = roomId;
      socket.playerName = playerName;
      socket.isRoomCreator = true;
      
      socket.emit('roomCreated', { roomId, players: roomData.players });
      
      console.log(`🏠 Room ${roomId} created by ${playerName} (Socket: ${socket.id})`);
    } catch (error) {
      console.error('❌ Create room error:', error);
      socket.emit('error', 'Failed to create room');
    }
  });

  // Join room
  socket.on('joinRoom', async (data) => {
    try {
      const { roomId, playerName } = data;
      let room = gameRooms.get(roomId);
      
      if (!room) {
        const dbRoom = await Room.findOne({ roomId });
        if (!dbRoom) {
          socket.emit('error', 'Room not found');
          return;
        }
        // Convert Mongoose document to plain object to avoid reference issues
        room = dbRoom.toObject();
        room.submissions = room.submissions || [];
        room.votes = room.votes || [];
        gameRooms.set(roomId, room);
      }
      
      // Check if this is the room creator reconnecting after page redirect
      let isReconnectingCreator = false;
      if (socket.roomCreator && socket.roomCreator.roomId === roomId && socket.roomCreator.playerName === playerName) {
        isReconnectingCreator = true;
        console.log(`🔄 Room creator ${playerName} reconnecting to ${roomId}`);
      }
      
      // Check if player already exists (including API-created players without socket ID)
      const existingPlayer = room.players.find(p => p.name === playerName);
      if (existingPlayer) {
        // Update socket ID - this handles API-created players and reconnections
        existingPlayer.socketId = socket.id;
        console.log(`🔄 ${playerName} connected with socket ${socket.id} (${existingPlayer.isHost ? 'Host' : 'Player'})`);
        
        // If game is playing, send player their cards
        if (room.status === 'playing' && existingPlayer.cards && existingPlayer.cards.length > 0) {
          console.log(`🎴 Sending cards to ${playerName} on reconnect:`, existingPlayer.cards.map(c => ({ id: c._id, name: c.name })));
          socket.emit('gameStarted', {
            cards: existingPlayer.cards,
            players: room.players,
            status: 'playing'
          });
          console.log(`🎴 Sent ${existingPlayer.cards.length} cards to ${playerName}`);
        }
      } else {
        // Only create new player if not created via API
        if (room.players.length >= 8) {
          socket.emit('error', 'Room is full');
          return;
        }
        
        const newPlayer = {
          socketId: socket.id,
          name: playerName,
          isHost: false,
          score: 0,
          cards: []
        };
        
        room.players.push(newPlayer);
        console.log(`👋 ${playerName} joined room ${roomId} as new player`);
      }
      
      // Store room info on socket
      socket.currentRoom = roomId;
      socket.playerName = playerName;
      
      await Room.updateOne({ roomId }, { players: room.players });
      socket.join(roomId);
      
      // Clear the room creator flag after successful join
      delete socket.roomCreator;
      
      io.to(roomId).emit('playerJoined', { 
        players: room.players,
        newPlayer: existingPlayer ? null : playerName 
      });
      
      console.log(`📊 Room ${roomId} status: ${room.players.length} players - ${room.players.map(p => `${p.name}(${p.socketId ? p.socketId.substr(-4) : 'no-socket'})`).join(', ')}`);
    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('error', 'Failed to join room');
    }
  });

  // Start game
  socket.on('startGame', async (roomId) => {
    try {
      const room = gameRooms.get(roomId);
      if (!room || room.players.length < 3) {
        socket.emit('error', 'Need at least 3 players to start');
        return;
      }

      // Check if requester is host
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || !player.isHost) {
        socket.emit('error', 'Only host can start the game');
        return;
      }

      // Deal meme template cards to players (6 cards each)
      const totalCardsNeeded = room.players.length * 6;
      const memeTemplates = await MemeTemplate.aggregate([{ $sample: { size: totalCardsNeeded } }]);
      
      console.log(`🎴 Dealing ${totalCardsNeeded} meme templates to ${room.players.length} players (6 cards each)`);
      
      if (memeTemplates.length < totalCardsNeeded) {
        console.log(`⚠️ Warning: Only ${memeTemplates.length} meme templates available, need ${totalCardsNeeded}`);
      }
      
      room.players.forEach((player, index) => {
        const startIndex = index * 6;
        const endIndex = Math.min(startIndex + 6, memeTemplates.length);
        player.cards = memeTemplates.slice(startIndex, endIndex);
        console.log(`🎴 ${player.name} received ${player.cards.length} cards`);
      });

      room.status = 'playing';
      
      // Update database with player cards
      await Room.updateOne({ roomId }, { 
        players: room.players, 
        status: 'playing',
        currentJudge: 0 
      });
      
      // Notify all players that game started with their cards
      room.players.forEach(player => {
        console.log(`🎴 Sending cards to ${player.name}:`, player.cards.map(c => ({ id: c._id, name: c.name })));
        
        // Ensure cards use Cloudinary URLs
        const cardsWithCloudinaryUrls = player.cards.map(card => ({
          ...card.toObject ? card.toObject() : card,
          imageUrl: card.cloudinaryUrl || card.imageUrl // Use Cloudinary URL if available
        }));
        
        io.to(player.socketId).emit('gameStarted', {
          cards: cardsWithCloudinaryUrls,
          players: room.players,
          status: 'playing'
        });
      });
      
      await startNewRound(roomId);
      
    } catch (error) {
      socket.emit('error', 'Failed to start game');
    }
  });

  // Stop game (Host only)
  socket.on('stopGame', async (roomId) => {
    try {
      const room = gameRooms.get(roomId);
      if (!room) return;

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || !player.isHost) {
        socket.emit('error', 'Only host can stop the game');
        return;
      }

      console.log(`🛑 Host ${player.name} stopped game in room ${roomId}`);

      // Clear any running countdown intervals
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
        console.log(`⏹️ Cleared countdown interval for room ${roomId}`);
      }

      // Reset all game state
      room.status = 'waiting';
      room.currentJudge = 0;
      room.currentCaption = null;
      room.submissions = [];
      room.shuffledSubmissions = [];
      room.votes = [];
      room.roundPhase = null;
      room.roundTimer = 0;

      // Reset player scores and clear cards
      room.players.forEach(p => {
        p.score = 0;
        p.cards = [];
      });

      // Update database
      await Room.updateOne({ roomId }, { 
        players: room.players, 
        status: 'waiting' 
      });

      console.log(`✅ Game stopped in room ${roomId}, all state reset`);
      io.to(roomId).emit('gameStopped', { players: room.players });
      
    } catch (error) {
      console.error('Stop game error:', error);
      socket.emit('error', 'Failed to stop game');
    }
  });

  // Kick player (Host only)
  socket.on('kickPlayer', async (data) => {
    try {
      const { roomId, playerId } = data;
      const room = gameRooms.get(roomId);
      if (!room) return;

      const host = room.players.find(p => p.socketId === socket.id);
      if (!host || !host.isHost) {
        socket.emit('error', 'Only host can kick players');
        return;
      }

      const playerIndex = room.players.findIndex(p => p.socketId === playerId);
      if (playerIndex === -1) return;

      const kickedPlayer = room.players[playerIndex];
      room.players.splice(playerIndex, 1);

      // Notify kicked player
      io.to(playerId).emit('kicked', 'You have been kicked from the room');
      
      // Check if room should be deleted
      if (room.players.length === 0) {
        await deleteRoom(roomId);
      } else {
        // Update database
        await Room.updateOne({ roomId }, { players: room.players });
        
        // Notify room
        io.to(roomId).emit('playerKicked', {
          playerName: kickedPlayer.name,
          players: room.players
        });
      }
      
    } catch (error) {
      socket.emit('error', 'Failed to kick player');
    }
  });

  // Submit card
  socket.on('submitCard', async (data) => {
    try {
      const { roomId, cardId } = data;
      const room = gameRooms.get(roomId);
      
      if (!room || room.status !== 'playing' || room.roundPhase !== 'submitting') return;
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      
      // Check if player already submitted
      if (room.submissions.find(s => s.playerId === socket.id)) return;
      
      // Find the submitted card
      const submittedCard = player.cards.find(card => card._id.toString() === cardId);
      if (!submittedCard) {
        console.log(`❌ Card ${cardId} not found in ${player.name}'s cards`);
        return;
      }
      
      // Add submission with proper card data copy (serialize to plain object)
      const submissionData = {
        playerId: socket.id,
        playerName: player.name,
        card: JSON.parse(JSON.stringify({
          _id: submittedCard._id,
          imageUrl: submittedCard.cloudinaryUrl || submittedCard.imageUrl, // Use Cloudinary URL if available
          description: submittedCard.description,
          tags: submittedCard.tags || []
        }))
      };
      
      // Debug: Log the submission data being added
      console.log(`🎴 Adding submission:`, {
        playerName: submissionData.playerName,
        cardExists: !!submissionData.card,
        cardImageUrl: submissionData.card?.imageUrl,
        cardId: submissionData.card?._id
      });
      
      room.submissions.push(submissionData);
      
      // Debug: Log room submissions after adding
      console.log(`🎴 Room submissions now:`, room.submissions.map(s => ({
        playerName: s.playerName,
        cardExists: !!s.card,
        cardImageUrl: s.card?.imageUrl
      })));
      
      console.log(`🎴 ${player.name} submitted card: ${submittedCard.description || submittedCard.imageUrl}`);
      
      // Notify all players about submission
      io.to(roomId).emit('cardSubmitted', {
        playerName: player.name,
        submissionsCount: room.submissions.length,
        totalPlayers: room.players.length
      });
      
      // Check if all players have submitted
      if (room.submissions.length === room.players.length) {
        console.log(`🎯 All players submitted cards in room ${roomId}, starting reveal phase`);
        
        // Clear countdown and start reveal immediately
        if (room.countdownInterval) {
          clearInterval(room.countdownInterval);
        }
        
        startRevealPhase(roomId);
      }
      
    } catch (error) {
      console.error('Submit card error:', error);
      socket.emit('error', 'Failed to submit card');
    }
  });

  // Vote for card
  socket.on('voteCard', async (data) => {
    try {
      const { roomId, submissionPlayerId } = data;
      const room = gameRooms.get(roomId);
      
      if (!room || room.status !== 'playing' || room.roundPhase !== 'voting') return;
      
      const voter = room.players.find(p => p.socketId === socket.id);
      if (!voter) return;
      
      // Cannot vote for own submission
      if (submissionPlayerId === socket.id) {
        socket.emit('error', 'Không thể vote cho meme của chính mình!');
        return;
      }
      
      // Check if player already voted
      const existingVote = room.votes.find(v => v.voterId === socket.id);
      if (existingVote) {
        socket.emit('error', 'Bạn đã vote rồi!');
        return;
      }
      
      // Check if submission exists
      const submission = room.submissions.find(s => s.playerId === submissionPlayerId);
      if (!submission) return;
      
      // Add vote
      room.votes.push({
        voterId: socket.id,
        voterName: voter.name,
        submissionPlayerId: submissionPlayerId,
        submissionPlayerName: submission.playerName
      });
      
      console.log(`🗳️ ${voter.name} voted for ${submission.playerName}'s meme`);
      
      // Notify all players about the vote
      io.to(roomId).emit('voteReceived', {
        voterName: voter.name,
        submissionPlayerName: submission.playerName,
        votesCount: room.votes.length,
        totalPlayers: room.players.length
      });
      
      // Check if all players have voted (excluding those who submitted)
      const playersWhoCanVote = room.players.filter(p => 
        room.submissions.find(s => s.playerId === p.socketId)
      ).length;
      
      if (room.votes.length === playersWhoCanVote) {
        console.log(`🎯 All players voted in room ${roomId}, calculating results`);
        
        // Clear countdown and calculate results immediately
        if (room.countdownInterval) {
          clearInterval(room.countdownInterval);
        }
        
        calculateResults(roomId);
      }
      
    } catch (error) {
      console.error('Vote card error:', error);
      socket.emit('error', 'Failed to vote');
    }
  });

  // Chat message
  socket.on('chatMessage', async (data) => {
    try {
      const { roomId, message } = data;
      const room = gameRooms.get(roomId);
      
      if (!room) return;
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      
      // Broadcast message to all players in room (except sender)
      socket.to(roomId).emit('chatMessage', {
        sender: player.name,
        message: message,
        timestamp: new Date().toLocaleTimeString('vi-VN', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      });
      
      console.log(`💬 ${player.name} in room ${roomId}: ${message}`);
      
    } catch (error) {
      console.error('Chat message error:', error);
    }
  });

  // Leave room manually
  socket.on('leaveRoom', async (roomId) => {
    try {
      const room = gameRooms.get(roomId);
      if (!room) return;

      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) return;

      const player = room.players[playerIndex];
      const isHost = player.isHost;

      console.log(`🚪 ${player.name} manually left room ${roomId} (Host: ${isHost})`);

      // Leave socket room
      socket.leave(roomId);

      // If host leaves, close the entire room and kick everyone
      if (isHost) {
        await closeRoomDueToHostLeaving(roomId, player.name);
      } else {
        // Normal player leaving
        room.players.splice(playerIndex, 1);

        // Check if room should be deleted
        if (room.players.length === 0) {
          await deleteRoom(roomId);
        } else {
          // Update database
          await Room.updateOne({ roomId }, { players: room.players });
          
          // Notify remaining players
          io.to(roomId).emit('playerLeft', {
            playerName: player.name,
            players: room.players
          });
        }
      }
      
    } catch (error) {
      console.error('Leave room error:', error);
    }
  });

  // Kick player (host only)
  socket.on('kickPlayer', async (data) => {
    try {
      const { roomId, playerNameToKick } = data;
      const room = gameRooms.get(roomId);
      
      if (!room) {
        socket.emit('kickError', { message: 'Phòng không tồn tại!' });
        return;
      }

      // Check if socket user is host
      const hostPlayer = room.players.find(p => p.socketId === socket.id);
      if (!hostPlayer || !hostPlayer.isHost) {
        socket.emit('kickError', { message: 'Chỉ host mới có thể kick player!' });
        return;
      }

      // Find player to kick
      const playerToKick = room.players.find(p => p.name === playerNameToKick);
      if (!playerToKick) {
        socket.emit('kickError', { message: 'Không tìm thấy player cần kick!' });
        return;
      }

      // Can't kick host
      if (playerToKick.isHost) {
        socket.emit('kickError', { message: 'Không thể kick host!' });
        return;
      }

      console.log(`🦶 Host ${hostPlayer.name} is kicking ${playerNameToKick} from room ${roomId}`);

      // Remove player from room
      const playerIndex = room.players.findIndex(p => p.name === playerNameToKick);
      room.players.splice(playerIndex, 1);

      // Notify the kicked player
      io.to(playerToKick.socketId).emit('kickedToLobby', {
        reason: 'kicked',
        message: `Bạn đã bị kick khỏi phòng bởi host ${hostPlayer.name}`
      });

      // Remove kicked player from socket room
      io.sockets.sockets.get(playerToKick.socketId)?.leave(roomId);

      // Update database
      await Room.updateOne({ roomId }, { players: room.players });

      // Notify remaining players
      io.to(roomId).emit('playerKicked', {
        kickedPlayerName: playerNameToKick,
        kickedBy: hostPlayer.name,
        players: room.players
      });

      console.log(`✅ ${playerNameToKick} has been kicked from room ${roomId} by ${hostPlayer.name}`);

    } catch (error) {
      console.error('Kick player error:', error);
      socket.emit('kickError', { message: 'Có lỗi xảy ra khi kick player!' });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('👋 Player disconnected:', socket.id);
    // Handle player disconnect from rooms
    handlePlayerDisconnect(socket.id);
  });
});

// Helper functions
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function startNewRound(roomId) {
  const room = gameRooms.get(roomId);
  const captions = await Caption.aggregate([{ $sample: { size: 1 } }]);
  
  // Deal new meme template cards to all players (6 cards each)
  const totalCardsNeeded = room.players.length * 6;
  const memeTemplates = await MemeTemplate.aggregate([{ $sample: { size: totalCardsNeeded } }]);
  
  console.log(`🎴 Dealing ${totalCardsNeeded} new meme templates for round`);
  
  if (memeTemplates.length < totalCardsNeeded) {
    console.log(`⚠️ Warning: Only ${memeTemplates.length} meme templates available, need ${totalCardsNeeded}`);
  }
  
  // Give each player 6 new cards
  room.players.forEach((player, index) => {
    const startIndex = index * 6;
    const endIndex = Math.min(startIndex + 6, memeTemplates.length);
    player.cards = memeTemplates.slice(startIndex, endIndex);
    console.log(`🎴 ${player.name} received ${player.cards.length} new cards for round`);
  });
  
  room.currentCaption = captions[0];
  room.submissions = []; // Ensure it's a plain array
  room.votes = [];
  room.roundPhase = 'submitting'; // submitting -> voting -> results
  room.roundTimer = 30; // 30 seconds countdown
  
  console.log(`🎯 New round started in room ${roomId}: "${room.currentCaption.text}"`);
  
  // Start countdown
  const countdownInterval = setInterval(() => {
    room.roundTimer--;
    
    // Emit countdown to all players
    io.to(roomId).emit('countdown', {
      timeLeft: room.roundTimer,
      phase: room.roundPhase
    });
    
    // Time's up for submission phase
    if (room.roundTimer <= 0 && room.roundPhase === 'submitting') {
      clearInterval(countdownInterval);
      startRevealPhase(roomId);
    }
  }, 1000);
  
  // Store interval for cleanup
  room.countdownInterval = countdownInterval;
  
  // Send new round info and new cards to all players
  room.players.forEach(player => {
    io.to(player.socketId).emit('newRound', {
      caption: room.currentCaption,
      players: room.players,
      timeLeft: room.roundTimer,
      phase: 'submitting',
      cards: player.cards // Send new cards to each player
    });
  });
}

async function startRevealPhase(roomId) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  room.roundPhase = 'revealing';
  
  console.log(`🎭 Reveal phase started in room ${roomId} with ${room.submissions.length} submissions`);
  
  // If no submissions, skip to next round
  if (room.submissions.length === 0) {
    console.log(`⚠️ No submissions in room ${roomId}, skipping round`);
    setTimeout(() => startNewRound(roomId), 2000);
    return;
  }
  
  // Create a proper copy and shuffle (don't modify original)
  const shuffledSubmissions = [...room.submissions].sort(() => Math.random() - 0.5);
  room.shuffledSubmissions = shuffledSubmissions; // Store for voting phase
  
  console.log(`🎭 Shuffled submissions:`, shuffledSubmissions.map(s => ({
    playerName: s.playerName,
    cardExists: !!s.card,
    cardImageUrl: s.card?.imageUrl
  })));
  
  // Show each submission one by one
  let currentIndex = 0;
  const revealInterval = setInterval(() => {
    if (currentIndex < shuffledSubmissions.length) {
      const submission = shuffledSubmissions[currentIndex];
      
      console.log(`🎭 Revealing submission ${currentIndex + 1}/${shuffledSubmissions.length} from ${submission.playerName}`);
      
      io.to(roomId).emit('revealSubmission', {
        caption: room.currentCaption,
        submission: {
          card: submission.card,
          playerName: submission.playerName
        },
        currentIndex: currentIndex + 1,
        totalSubmissions: shuffledSubmissions.length
      });
      
      currentIndex++;
    } else {
      // All submissions revealed, start voting
      clearInterval(revealInterval);
      setTimeout(() => startVotingPhase(roomId), 1500); // Short pause before voting
    }
  }, 5000); // Show each submission for 5 seconds
  
  room.countdownInterval = revealInterval;
}

async function startVotingPhase(roomId) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  room.roundPhase = 'voting';
  room.roundTimer = 20; // 20 seconds for voting
  room.votes = [];
  
  console.log(`🗳️ Voting phase started in room ${roomId} with ${room.submissions.length} submissions`);
  
  // Use the shuffled submissions from reveal phase
  const shuffledSubmissions = room.shuffledSubmissions || room.submissions;
  
  // Start voting countdown
  const votingInterval = setInterval(() => {
    room.roundTimer--;
    
    io.to(roomId).emit('countdown', {
      timeLeft: room.roundTimer,
      phase: room.roundPhase
    });
    
    // Time's up for voting
    if (room.roundTimer <= 0) {
      clearInterval(votingInterval);
      calculateResults(roomId);
    }
  }, 1000);
  
  room.countdownInterval = votingInterval;
  
  // Debug log submissions before sending
  console.log('🗳️ Submissions before sending to client:', shuffledSubmissions.map(s => ({
    playerId: s.playerId,
    playerName: s.playerName,
    cardExists: !!s.card,
    cardDescription: s.card?.description,
    cardImageUrl: s.card?.imageUrl,
    cardId: s.card?._id
  })));

  // Send voting phase to all players
  io.to(roomId).emit('votingPhase', {
    caption: room.currentCaption,
    submissions: shuffledSubmissions.map(s => ({
      id: s.playerId,
      card: s.card,
      playerName: s.playerName
    })),
    timeLeft: room.roundTimer
  });
}

async function calculateResults(roomId) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  room.roundPhase = 'results';
  
  // Count votes for each submission
  const voteCount = {};
  room.submissions.forEach(s => {
    voteCount[s.playerId] = 0;
  });
  
  room.votes.forEach(vote => {
    if (voteCount.hasOwnProperty(vote.submissionPlayerId)) {
      voteCount[vote.submissionPlayerId]++;
    }
  });
  
  // Find winner(s)
  const maxVotes = Math.max(...Object.values(voteCount));
  const winners = Object.keys(voteCount).filter(playerId => voteCount[playerId] === maxVotes);
  
  console.log(`📊 Vote results in room ${roomId}:`, voteCount);
  
  // Award points to winner(s)
  winners.forEach(winnerPlayerId => {
    const winner = room.players.find(p => p.socketId === winnerPlayerId);
    if (winner) {
      winner.score++;
      console.log(`🏆 ${winner.name} won with ${maxVotes} votes!`);
    }
  });
  
  // Prepare results data
  const results = {
    caption: room.currentCaption,
    submissions: room.submissions.map(s => ({
      playerName: s.playerName,
      card: s.card,
      votes: voteCount[s.playerId] || 0,
      isWinner: winners.includes(s.playerId)
    })),
    winners: winners.map(id => room.players.find(p => p.socketId === id)?.name).filter(Boolean),
    players: room.players,
    maxVotes
  };
  
  // Send results
  io.to(roomId).emit('roundResults', results);
  
  // Check for game winner (first to 7 points)
  const gameWinner = room.players.find(p => p.score >= 7);
  if (gameWinner) {
    console.log(`🎉 ${gameWinner.name} won the game with ${gameWinner.score} points!`);
    
    room.status = 'finished';
    
    io.to(roomId).emit('gameOver', {
      winner: gameWinner.name,
      players: room.players,
      finalScore: gameWinner.score
    });
    
    // Update database
    await Room.updateOne({ roomId }, { 
      players: room.players, 
      status: 'finished' 
    });
    
    return;
  }
  
  // Start next round after showing results
  setTimeout(() => {
    startNewRound(roomId);
  }, 5000); // 5 seconds to show results
}

// Store disconnected socket info temporarily
const disconnectedSockets = new Map();

async function handlePlayerDisconnect(socketId) {
  console.log(`👋 Player disconnected: ${socketId}`);
  
  // Find player in any room
  let disconnectedPlayer = null;
  let disconnectedRoomId = null;
  let isCreator = false;
  
  for (const [roomId, room] of gameRooms) {
    const player = room.players.find(p => p.socketId === socketId);
    if (player) {
      disconnectedPlayer = player;
      disconnectedRoomId = roomId;
      isCreator = player.isHost;
      break;
    }
  }
  
  if (!disconnectedPlayer) {
    console.log(`No player found for socket ${socketId}`);
    return;
  }
  
  console.log(`👋 ${disconnectedPlayer.name} disconnected from room ${disconnectedRoomId} (Creator: ${isCreator})`);
  
  // If this is a room creator, give grace period then close room
  if (isCreator) {
    console.log(`⏳ Room creator ${disconnectedPlayer.name} disconnected, giving 8 seconds grace period...`);
    
    // Store disconnect info
    disconnectedSockets.set(socketId, {
      player: disconnectedPlayer,
      roomId: disconnectedRoomId,
      timestamp: Date.now()
    });
    
    // Wait 8 seconds before cleaning up creator's room
    setTimeout(async () => {
      // Check if creator has reconnected
      const room = gameRooms.get(disconnectedRoomId);
      if (room) {
        const creatorStillExists = room.players.find(p => p.name === disconnectedPlayer.name && p.socketId !== socketId);
        if (!creatorStillExists) {
          console.log(`⌛ Grace period expired, host left - closing room ${disconnectedRoomId}`);
          await closeRoomDueToHostLeaving(disconnectedRoomId, disconnectedPlayer.name);
        } else {
          console.log(`✅ Creator ${disconnectedPlayer.name} reconnected successfully`);
        }
      }
      
      // Clean up stored info
      disconnectedSockets.delete(socketId);
    }, 8000);
    return; // Don't immediately clean up creator's room
  }
  
  // Normal disconnect - immediate cleanup
  await performRoomCleanup(disconnectedRoomId, socketId);
}

async function performRoomCleanup(roomId, socketId) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  const playerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return;
  
  const player = room.players[playerIndex];
  room.players.splice(playerIndex, 1);
  
  console.log(`🧹 Cleaning up ${player.name} from room ${roomId} (${room.players.length} players remaining)`);
  
  if (room.players.length === 0) {
    await deleteRoom(roomId);
  } else {
    // Update database and notify remaining players
    try {
      await Room.updateOne({ roomId }, { players: room.players });
      
      io.to(roomId).emit('playerLeft', {
        playerName: player.name,
        players: room.players
      });
    } catch (error) {
      console.error(`❌ Error updating room ${roomId}:`, error);
    }
  }
}

async function closeRoomDueToHostLeaving(roomId, hostName) {
  try {
    const room = gameRooms.get(roomId);
    if (!room) return;

    console.log(`🚪 Closing room ${roomId} due to host ${hostName} leaving`);

    // Clear any running countdown intervals
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }

    // Notify all players that host left and room is closing
    io.to(roomId).emit('hostLeft', {
      hostName: hostName,
      message: `Host ${hostName} đã rời phòng. Phòng sẽ bị đóng và tất cả người chơi về sảnh.`
    });

    // Give players 3 seconds to see the message before redirecting
    setTimeout(() => {
      // Kick all remaining players to lobby
      io.to(roomId).emit('kickedToLobby', {
        reason: 'host_left',
        message: 'Host đã rời phòng, bạn được chuyển về sảnh'
      });

      // Remove all players from socket room
      io.in(roomId).socketsLeave(roomId);

      // Delete the room
      deleteRoom(roomId);
    }, 3000);

  } catch (error) {
    console.error(`❌ Error closing room due to host leaving ${roomId}:`, error);
  }
}

async function deleteRoom(roomId) {
  try {
    // Remove from memory
    gameRooms.delete(roomId);
    
    // Remove from database
    await Room.deleteOne({ roomId });
    
    console.log(`🗑️ Room ${roomId} has been deleted`);
    
    // Notify all clients in room (if any) that room is closing
    io.to(roomId).emit('roomDeleted', { message: 'Room has been closed' });
    
    // Clear the socket room
    io.in(roomId).socketsLeave(roomId);
    
  } catch (error) {
    console.error(`❌ Error deleting room ${roomId}:`, error);
  }
}

// Auto cleanup old rooms every 10 minutes
setInterval(async () => {
  const cutoffTime = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
  
  try {
    // Clean up from database
    const result = await Room.deleteMany({ 
      createdAt: { $lt: cutoffTime },
      status: { $in: ['waiting', 'finished'] }
    });
    
    // Clean up from memory
    for (const [roomId, room] of gameRooms.entries()) {
      if (room.createdAt && room.createdAt < cutoffTime && 
          ['waiting', 'finished'].includes(room.status)) {
        gameRooms.delete(roomId);
        console.log(`🧹 Auto-cleaned room ${roomId} from memory`);
      }
    }
    
    if (result.deletedCount > 0) {
      console.log(`🧹 Auto-cleaned ${result.deletedCount} old rooms from database`);
    }
  } catch (error) {
    console.error('❌ Auto-cleanup error:', error);
  }
}, 10 * 60 * 1000);

console.log('🧹 Auto-cleanup scheduled every 10 minutes');

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎮 Game URL: http://localhost:${PORT}`);
  
  if (!isProduction) {
    console.log('📝 Available endpoints:');
    console.log('   GET  / - Landing page');
    console.log('   GET  /game/:roomId - Game room');
    console.log('   GET  /health - Health check');
    console.log('   POST /api/create-room - Create new room');
    console.log('   POST /api/join-room - Join existing room');
  }
}); 