require('dotenv').config();
const mongoose = require('mongoose');
const News = require('./models/News');

const seedData = [
  // === GÜNDEM (featured) ===
  {
    title: "TOKİ'DE KURA SONUÇLARI BELLİ OLDU",
    description: "Çorlu'da TOKİ konut projesi kura çekimi gerçekleştirildi. Hak sahipleri belirlendi.",
    category: "Gündem",
    image: "/uploads/13220263TfUu5lQ1syBm8Cn.jpg",
    featured: true,
    createdAt: new Date('2026-02-13')
  },
  {
    title: "ÇORLU ÇEVRE PLATFORMU ÇEVRE İÇİN SAVAŞACAK",
    description: "Çorlu Çevre Platformu, bölgedeki çevre sorunlarına karşı mücadele başlatacağını açıkladı.",
    category: "Gündem",
    image: "/uploads/1222026LPl2OZm12-oUEEdd.jpg",
    featured: true,
    createdAt: new Date('2026-02-12')
  },
  {
    title: "OKULA GİTMEK ÇİLEYE DÖNÜŞTÜ!",
    description: "Çorlu'da okul yollarının durumu öğrenci ve velilerin gündeminde. Yetkililere çağrı yapıldı.",
    category: "Yaşam",
    image: "/uploads/1222026lolF-mm9a_8mhDyq.jpg",
    featured: true,
    createdAt: new Date('2026-02-12')
  },

  // === GÜNDEM ===
  {
    title: "\"Büyü Bozma\" Vaadiyle 46 Milyon TL'lik Vurgun: 19 Tutuklama",
    description: "Tekirdağ'da sosyal medya üzerinden kendilerini \"büyücü\", \"medyum\" ve \"manevi hoca\" olarak tanıtan şüpheliler yakalandı.",
    category: "Gündem",
    image: "/uploads/1422026BPP80Q8c_FQ3I-Kc-m.jpg",
    createdAt: new Date('2026-02-14')
  },
  {
    title: "Ne Çözüm Bulunuyor Ne de Engelleniyor!",
    description: "Vatandaşların uzun süredir şikayet ettiği sorunlara çözüm üretilmemesi tepkilere yol açtı.",
    category: "Gündem",
    image: "/uploads/1422026r7sF7CFksvgLKpDJ-m.jpg",
    createdAt: new Date('2026-02-14')
  },
  {
    title: "Trakya'da Sevgililer Günü Yoğunluğu Çiçekçilere Yansıdı",
    description: "14 Şubat Sevgililer Günü dolayısıyla Trakya genelinde çiçekçiler yoğun ilgi gördü.",
    category: "Gündem",
    image: "/uploads/1422026-NFqyQnO8hFuOe6r-m.jpg",
    createdAt: new Date('2026-02-14')
  },
  {
    title: "Suça Sürüklenen Çocuklar Konusunda Çok Boyutlu Çözüm Vurgusu",
    description: "Çocukların suça sürüklenmesinin önlenmesi için kapsamlı çalışmalar başlatıldı.",
    category: "Gündem",
    image: "/uploads/1422026SgJPN236lhFyBjDH-m.jpg",
    createdAt: new Date('2026-02-14')
  },
  {
    title: "BASININ DESTEKLENMESİNE YÖNELİK DÜZENLEMELER",
    description: "Basın İlan Kurumu Genel Kurulu, basın çalışanlarına yönelik sosyal desteklerin yeniden düzenlenmesini karara bağladı.",
    category: "Gündem",
    image: "/uploads/142202644-_tkRHOm4cLeyS-s.jpg",
    createdAt: new Date('2026-02-14')
  },
  {
    title: "CAMİLER RAMAZAN ÖNCESİ TEMİZLENDİ",
    description: "Süleymanpaşa Belediyesi Temizlik İşleri ekipleri, Ramazan öncesi camilerin temizliğini yaptı.",
    category: "Gündem",
    image: "/uploads/14220263YTJV9aovyCCI_AZ-s.jpg",
    createdAt: new Date('2026-02-14')
  },

  // === EKONOMİ ===
  {
    title: "Trakya'dan Geçen Ay 284 Milyon 313 Bin Dolarlık İhracat Yapıldı",
    description: "Kırklareli, Edirne ve Tekirdağ'dan geçen ay 284 milyon 313 bin dolarlık ihracat gerçekleştirildi.",
    category: "Ekonomi",
    image: "/uploads/112026p0ksi8Qs-kN8K14C-s.jpg",
    createdAt: new Date('2026-02-11')
  },
  {
    title: "Çorlu TSO, AB-Türkiye Odalar Ortaklığı Kapsamında Büyük Başarıya İmza Attı",
    description: "Çorlu Ticaret ve Sanayi Odası, Eurochambres ve TOBB iş birliğiyle önemli bir projeyi hayata geçirdi.",
    category: "Ekonomi",
    image: "/uploads/201120257JF9sZk7LRNK96Ny-s.jpg",
    createdAt: new Date('2026-02-10')
  },
  {
    title: "Türkiye'nin Girişimci Kadın Gücü Yarışması Ödül Töreni Gerçekleşti",
    description: "Çorlu TSO heyeti, Türkiye'nin Girişimci Kadın Gücü Yarışması ödül törenine katıldı.",
    category: "Ekonomi",
    image: "/uploads/20112025517zLydvjPJhvYpc-s.jpg",
    createdAt: new Date('2026-02-09')
  },
  {
    title: "2026 Yılı Teşvikleri Değerlendirildi",
    description: "Çorlu TSO ev sahipliğinde, Tekirdağ Valisi'nin katılımıyla 2026 yılı teşvikleri masaya yatırıldı.",
    category: "Ekonomi",
    image: "/uploads/20112025oo0SZvyNTZQk0zk9-s.jpg",
    createdAt: new Date('2026-02-08')
  },

  // === SPOR ===
  {
    title: "IC Tredaş Spor Kulübü Kız Takımı Göz Kamaştırıyor",
    description: "Trakya'da elektriği kaliteli veren kurumun spor alanındaki başarıları da dikkat çekiyor.",
    category: "Spor",
    image: "/uploads/1322026I5bGvY28hjYpJv9y-s.jpg",
    createdAt: new Date('2026-02-13')
  },
  {
    title: "Çorluspor 1947'ye Moral Ziyareti",
    description: "Çorlu Belediye Başkanı Ahmet Sarıkurt, Çorluspor 1947 kulübünü ziyaret etti.",
    category: "Spor",
    image: "/uploads/1322026ohFYKjLpdmoaYpRp-s.jpg",
    createdAt: new Date('2026-02-13')
  },
  {
    title: "Çorlu'da Satranç Turnuvası Gerçekleşti",
    description: "2025-2026 Eğitim Öğretim Yılı Okul Sporları kapsamında Çorlu'da satranç turnuvası düzenlendi.",
    category: "Spor",
    image: "/uploads/1222026CUhJjLTGl7CgAJns-s.jpg",
    createdAt: new Date('2026-02-12')
  },
  {
    title: "Çorluspor 1947, Kestel Çilekspor'u Ağırlayacak",
    description: "Çorluspor 1947, Nesine 3. Lig 1. Grup 21. hafta maçında Kestel Çilekspor'u ağırlayacak.",
    category: "Spor",
    image: "/uploads/1222026BRNeHOhLlyb2LNfD-s.jpg",
    createdAt: new Date('2026-02-12')
  },

  // === YAŞAM ===
  {
    title: "Çorlu'da Genç Adamın Acı Ölümü",
    description: "Çorlu'da meydana gelen olayda genç bir adam hayatını kaybetti.",
    category: "Yaşam",
    image: "/uploads/422026ZEEZGv7jvq9ZDnZ4-s.jpg",
    createdAt: new Date('2026-02-04')
  },
  {
    title: "Çorlu'da Metruk Yapılar Yıkılıyor",
    description: "Çorlu Belediyesi, ilçedeki metruk yapıların yıkım çalışmalarına başladı.",
    category: "Yaşam",
    image: "/uploads/3112026pueAE8J95yEmHavu-s.jpg",
    createdAt: new Date('2026-01-31')
  }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB bağlantısı başarılı');

    // Clear existing data
    await News.deleteMany({});
    console.log('Mevcut veriler temizlendi');

    // Insert seed data
    await News.insertMany(seedData);
    console.log(`${seedData.length} haber başarıyla eklendi!`);

    await mongoose.disconnect();
    console.log('Tamamlandı.');
    process.exit(0);
  } catch (err) {
    console.error('Hata:', err);
    process.exit(1);
  }
}

seed();
