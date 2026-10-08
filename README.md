# Yerbol Abdumannopov — portfolio

## Talablar

- Node.js 20 yoki undan yangisi
- Gmail SMTP App Password (email orqali kirish kodlari uchun)
- Telegram bot tokeni va xabar yuboriladigan chat ID (buyurtma xabarlari uchun)

## Ishga tushirish

1. `npm install`
2. `.env.example` faylidan `.env` nusxa oling.
3. `.env` ichida `SESSION_SECRET` qiymatini kamida 32 belgili tasodifiy maxfiy qiymatga almashtiring. Gmail hisobida ikki bosqichli himoyani yoqib, App Password yarating va `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` maydonlarini to‘ldiring.
4. Yangi Telegram bot yarating, `TELEGRAM_BOT_TOKEN` va `TELEGRAM_CHAT_ID` qiymatlarini kiriting. Token hech qachon brauzer kodi yoki repozitoriyga qo‘shilmasin.
5. `npm run dev` (ishlab chiqish) yoki `npm start` buyrug‘ini bajaring va `http://localhost:3000` manzilini oching.

SQLite bazasi birinchi ishga tushishda `data/portfolio.sqlite` manzilida yaratiladi. SQLite WebAssembly asosida ishlaydi, shuning uchun C++ kompilyatori yoki native build vositalari kerak emas.

## Xususiyatlar

- Uzbek tilidagi, telefon/planshet/kompyuterga mos portfolio sahifasi va Three.js animatsiyasi.
- Alohida ochib ishlatish mumkin bo‘lgan, bitta HTML fayldagi interaktiv Three.js hero demo: `/three-animation.html`.
- Email tasdiqlash kodi bilan ro‘yxatdan o‘tish va kirish. Kod 10 daqiqa amal qiladi, 5 ta tekshirish urinishidan so‘ng bekor qilinadi.
- Buyurtma formasi buyurtmalarni SQLite bazasiga saqlaydi va Telegramga yuboradi.
- Admin paneliga faqat serverdagi `ADMIN_EMAIL` bilan tasdiqlangan email orqali kirish mumkin. Standart manzil: `erbolabdumannopovcode@gmail.com`.

Email OTP uchun SMTP sozlamalari shart. Telegram sozlamalari yoki yuborish ishlamasa, buyurtma bazaga yoziladi va foydalanuvchiga Telegramga xabar yetib bormagani haqida xato ko‘rsatiladi. Ishlab chiqarish muhitida HTTPS ishlating; `NODE_ENV=production` sessiya cookie’sini `Secure` qiladi.
