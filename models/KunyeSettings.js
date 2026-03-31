const mongoose = require('mongoose');

const kunyeSettingsSchema = new mongoose.Schema({
  singletonKey: {
    type: String,
    unique: true,
    default: 'main'
  },
  publisher: { type: String, default: '59 HABER KUTUSU' },
  tradeName: { type: String, default: 'www59haberkutusu.com.tr' },
  establishmentDate: { type: String, default: '16.10.2025' },
  legalRepresentative: { type: String, default: 'Mehmetcan ARSLAN' },
  editorInChief: { type: String, default: 'Ege ARSLAN' },
  managementAddress: {
    type: String,
    default: 'Reşadiye Mahallesi, Şinasi Kurşun Caddesi, 7. Sokak, Mazlum Ap. No: 2 D: 6, Tekirdağ'
  },
  reporters: {
    type: [String],
    default: []
  },
  hostingProvider: { type: String, default: 'Render' },
  hostingTradeName: { type: String, default: 'Render Services, Inc.' },
  hostingAddress: { type: String, default: '525 Brannan St, Suite 300, San Francisco, CA 94107' },
  corporateEmail: { type: String, default: '59haberkutusucom@gmail.com' },
  contactPhone: { type: String, default: '+90 533 477 36 39' }
}, {
  timestamps: true
});

module.exports = mongoose.model('KunyeSettings', kunyeSettingsSchema);
