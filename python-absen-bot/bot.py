import os
import sqlite3
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# Setup logging agar kita tahu jika ada error saat "menyeduh" server
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

# Ganti token di baris bawah ini dengan milik Anda untuk testing lokal,
# Atau lebih baik ambil dari environment variable jika di production
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8622622623:AAHozo75dLNV-IS7uKfASRe9IQPEmsVyizY")

# ==========================================
# 1. ARSITEKTUR DATABASE (Radar Pelacak)
# ==========================================
def init_db():
    """Membangun fondasi database jika belum ada."""
    conn = sqlite3.connect("radar_anggota.db")
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT,
            first_name TEXT,
            UNIQUE(chat_id, user_id)
        )
    ''')
    conn.commit()
    conn.close()

def track_member(chat_id, user):
    """Mencatat anggota yang lewat di radar (INSERT OR REPLACE)."""
    conn = sqlite3.connect("radar_anggota.db")
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO group_members (chat_id, user_id, username, first_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(chat_id, user_id) DO UPDATE SET
            username=excluded.username,
            first_name=excluded.first_name
    ''', (chat_id, user.id, user.username, user.first_name))
    conn.commit()
    conn.close()

def get_members(chat_id):
    """Mengambil semua anggota grup yang terekam radar."""
    conn = sqlite3.connect("radar_anggota.db")
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, username, first_name FROM group_members WHERE chat_id = ?", (chat_id,))
    rows = cursor.fetchall()
    conn.close()
    return rows

# ==========================================
# 2. LOGIKA TELEGRAM
# ==========================================
async def tracker_middleware(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Menangkap pesan di grup dan mencatat anggotanya tanpa mengganggu alur pesan."""
    if update.effective_chat and update.effective_chat.type in ['group', 'supergroup']:
        if update.effective_user and not update.effective_user.is_bot:
            track_member(update.effective_chat.id, update.effective_user)

async def absen_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Perintah /absen untuk memanggil seluruh penghuni grup."""
    if not update.effective_chat:
        return
        
    chat_id = update.effective_chat.id
    
    # Hanya berfungsi di dalam grup
    if update.effective_chat.type not in ['group', 'supergroup']:
        await update.message.reply_text("Perintah ini hanya didesain untuk di dalam grup.")
        return

    # Ambil anggota dari database
    members = get_members(chat_id)
    if not members:
        await update.message.reply_text("Belum ada anggota grup yang terekam di radar. Coba ngobrol dulu!")
        return

    # Rakit pesan mention
    mentions = []
    for user_id, username, first_name in members:
        if username:
            mentions.append(f"@{username}")
        else:
            name = first_name if first_name else "Anggota"
            # Menggunakan inline HTML link jika tidak ada username
            mentions.append(f'<a href="tg://user?id={user_id}">{name}</a>')

    text = "📢 **Panggilan kepada semua anggota grup yang terekam:**\n\n" + " ".join(mentions)
    await update.message.reply_html(text)

# ==========================================
# 3. TITIK JALAN APLIKASI
# ==========================================
def main():
    if TOKEN == "ISI_TOKEN_DARI_BOTFATHER_DI_SINI":
        print("❌ ERROR: Silakan ganti nilai TOKEN dengan token asli dari BotFather terlebih dahulu.")
        return

    # Pastikan tabel sudah dibuat sebelum bot berjalan
    init_db()
    
    app = Application.builder().token(TOKEN).build()
    
    # Daftarkan command /absen
    app.add_handler(CommandHandler("absen", absen_command))
    
    # Daftarkan pendengar (tracker) untuk SELURUH pesan teks biasa (bukan command)
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, tracker_middleware))
    
    print("☕ Bot sedang menyeduh kopi dan siap bekerja...")
    app.run_polling()

if __name__ == '__main__':
    main()
