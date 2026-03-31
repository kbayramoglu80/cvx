const mongoose = require('mongoose');

const aboutSettingsSchema = new mongoose.Schema({
  singletonKey: {
    type: String,
    required: true,
    unique: true,
    default: 'main'
  },
  aboutText: {
    type: String,
    default: ''
  },
  copyrightText: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AboutSettings', aboutSettingsSchema);
