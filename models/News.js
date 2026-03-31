const mongoose = require('mongoose');

function slugifyTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const newsSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: true,
    enum: ['Gündem', 'Ekonomi', 'Spor', 'Siyaset', 'Yaşam', 'Sağlık', 'Son Dakika'],
    default: 'Gündem'
  },
  categories: {
    type: [{
      type: String,
      enum: ['Gündem', 'Ekonomi', 'Spor', 'Siyaset', 'Yaşam', 'Sağlık', 'Son Dakika']
    }],
    default: ['Gündem']
  },
  image: {
    type: String,
    default: ''
  },
  publishedAt: {
    type: Date,
    default: null
  },
  slug: {
    type: String,
    default: '',
    trim: true
  },
  featured: {
    type: Boolean,
    default: false
  },
  placement: {
    type: String,
    enum: ['none', 'homepage', 'hero', 'both'],
    default: 'none'
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

newsSchema.index({ category: 1, createdAt: -1 });
newsSchema.index({ categories: 1, createdAt: -1 });
newsSchema.index({ featured: 1 });
newsSchema.index({ placement: 1, createdAt: -1 });
newsSchema.index({ publishedAt: -1 });
newsSchema.index({ slug: 1 }, { unique: true, sparse: true });

newsSchema.pre('validate', async function(next) {
  try {
    if (!this.title) return next();
    if (!this.isModified('title') && this.slug) return next();

    const base = slugifyTitle(this.title) || 'haber';
    const NewsModel = this.constructor;
    let candidate = base;
    let counter = 2;

    while (await NewsModel.exists({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }

    this.slug = candidate;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('News', newsSchema);
