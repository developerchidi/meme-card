const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 20
  },
  email: {
    type: String,
    sparse: true, // Allow null values
    lowercase: true,
    trim: true
  },
  avatar: {
    type: String,
    default: null // URL to avatar image
  },
  statistics: {
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    currentWinStreak: { type: Number, default: 0 },
    favoriteCaption: { type: String, default: null },
    judgeWins: { type: Number, default: 0 }, // Times others chose their cards
    judgeDecisions: { type: Number, default: 0 } // Times they were judge
  },
  preferences: {
    soundEnabled: { type: Boolean, default: true },
    animationsEnabled: { type: Boolean, default: true },
    autoJoinEnabled: { type: Boolean, default: false },
    preferredLanguage: { type: String, default: 'vi' }
  },
  badges: [{
    name: String,
    description: String,
    earnedAt: { type: Date, default: Date.now }
  }],
  isActive: { 
    type: Boolean, 
    default: true 
  },
  lastActive: { 
    type: Date, 
    default: Date.now 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Virtual for win rate
playerSchema.virtual('winRate').get(function() {
  if (this.statistics.gamesPlayed === 0) return 0;
  return (this.statistics.gamesWon / this.statistics.gamesPlayed * 100).toFixed(1);
});

// Index for efficient querying  
playerSchema.index({ 'statistics.gamesWon': -1 });
playerSchema.index({ lastActive: -1 });

module.exports = mongoose.model('Player', playerSchema); 