const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  media: {
    type: String,
    required: true,
    default: ''
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image'
  },
  link: {
    type: String,
    default: '#',
    trim: true
  },
  position: {
    type: String,
    enum: ['left', 'right', 'top', 'bottom', 'custom'],
    required: true,
    default: 'left'
  },
  pageTarget: {
    type: String,
    enum: ['all', 'home', 'category', 'detail', 'kunye'],
    default: 'all'
  },
  deviceTarget: {
    type: String,
    enum: ['both', 'desktop', 'mobile'],
    default: 'both'
  },
  orientation: {
    type: String,
    enum: ['vertical', 'horizontal', 'tilt-right', 'tilt-left'],
    default: 'vertical'
  },
  width: {
    type: Number,
    default: 350,
    min: 80,
    max: 3000
  },
  height: {
    type: Number,
    default: 250,
    min: 80,
    max: 3000
  },
  mobileWidth: {
    type: Number,
    default: 320,
    min: 80,
    max: 1200
  },
  mobileHeight: {
    type: Number,
    default: 250,
    min: 80,
    max: 1600
  },
  startDate: {
    type: Date,
    default: null
  },
  endDate: {
    type: Date,
    default: null
  },
  customStyles: {
    type: String,
    default: '',
    trim: true
  },
  customTop: {
    type: Number,
    default: 180
  },
  customLeft: {
    type: Number,
    default: 12
  },
  customZIndex: {
    type: Number,
    default: 60
  },
  rotateSeconds: {
    type: Number,
    default: 7,
    min: 1,
    max: 120
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

adSchema.index({ active: 1, position: 1, pageTarget: 1, createdAt: -1 });
adSchema.index({ position: 1, pageTarget: 1, sortOrder: 1, createdAt: 1 });
adSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Ad', adSchema);
