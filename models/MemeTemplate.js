const mongoose = require('mongoose');

const memeTemplateSchema = new mongoose.Schema({
  imageUrl: { 
    type: String, 
    required: true 
  },
  description: { 
    type: String,
    trim: true
  },
  tags: [{ 
    type: String,
    lowercase: true,
    trim: true
  }],
  difficulty: { 
    type: String, 
    enum: ['easy', 'medium', 'hard'], 
    default: 'medium' 
  },
  popularity: { 
    type: Number, 
    default: 0 
  }, // Track usage frequency
  isActive: { 
    type: Boolean, 
    default: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Index for efficient querying
memeTemplateSchema.index({ isActive: 1, difficulty: 1 });
memeTemplateSchema.index({ tags: 1 });

module.exports = mongoose.model('MemeTemplate', memeTemplateSchema); 