const mongoose = require('mongoose');

const captionSchema = new mongoose.Schema({
  text: { 
    type: String, 
    required: true,
    trim: true
  },
  category: { 
    type: String,
    enum: ['funny', 'relatable', 'random', 'pop-culture', 'tech', 'life', 'work', 'school'],
    default: 'random'
  },
  difficulty: { 
    type: String, 
    enum: ['easy', 'medium', 'hard'], 
    default: 'medium' 
  },
  tags: [{ 
    type: String,
    lowercase: true,
    trim: true
  }],
  language: { 
    type: String, 
    default: 'vi' // Vietnamese
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  usageCount: { 
    type: Number, 
    default: 0 
  }, // Track how often this caption is played
  winRate: { 
    type: Number, 
    default: 0 
  }, // Track how often this caption wins
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Index for efficient querying
captionSchema.index({ isActive: 1, category: 1 });
captionSchema.index({ difficulty: 1 });
captionSchema.index({ language: 1 });

module.exports = mongoose.model('Caption', captionSchema); 