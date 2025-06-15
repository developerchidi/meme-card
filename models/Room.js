const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  socketId: { type: String, required: false }, // Optional since API-created players don't have socket initially
  name: { type: String, required: true },
  isHost: { type: Boolean, default: false },
  score: { type: Number, default: 0 },
  cards: [{ type: mongoose.Schema.Types.Mixed }] // Caption cards in hand
});

const submissionSchema = new mongoose.Schema({
  playerId: String,
  playerName: String,
  cardId: String,
  cardText: String
});

const roomSchema = new mongoose.Schema({
  roomId: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true
  },
  players: [playerSchema],
  status: { 
    type: String, 
    enum: ['waiting', 'playing', 'finished'], 
    default: 'waiting' 
  },
  currentJudge: { type: Number, default: 0 },
  currentCaption: { type: mongoose.Schema.Types.Mixed }, // Current caption text
  submissions: [submissionSchema], // Player submissions for current round
  maxPlayers: { type: Number, default: 8 },
  winCondition: { type: Number, default: 7 }, // Points needed to win
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Auto-update updatedAt on save
roomSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Clean up old rooms (older than 24 hours)
roomSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Room', roomSchema); 