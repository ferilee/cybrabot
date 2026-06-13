## **Ringkasan Proyek: @CybraFeriBot (Node/Bun Version)**

**CybraFeriBot** adalah bot Telegram *Hybrid* berperforma tinggi yang dibangun menggunakan **Bun runtime** dan **Hono framework**, dirancang untuk integrasi AI yang cepat dan manajemen data yang efisien.

### **1. Alur Kerja (Workflow)**

1. **High-Speed Input:** Pesan diterima oleh server **Hono** melalui Telegram Webhook (lebih cepat dan efisien daripada polling biasa).
2. **Lightweight NLP (Compromise.js / Natural):**
* Menggunakan library **Compromise** untuk melakukan analisis teks cepat (seperti mendeteksi kata benda, kata kerja, atau nilai angka) tanpa beban komputasi besar.


3. **Intent Routing (LangChain.js):**
* **Router Otomatis:** Menggunakan LangChain untuk menentukan apakah pesan adalah perintah teknis (Matematika/Admin) atau obrolan santai.


4. **Database Action (Bun SQLite):** Jika pesan bersifat teknis, bot mengakses **SQLite** secara native untuk mengambil data atau menyimpan progres belajar.
5. **Generative Response (LLM API):** Jika pesan bersifat umum, **LangChain.js** meneruskannya ke LLM untuk menghasilkan balasan yang manusiawi.
6. **Output:** Jawaban dikirim kembali secara instan melalui API Telegram.

---

### **2. Fitur Utama & Tech Stack**

* **Runtime:** **Bun** – Memberikan kecepatan eksekusi dan manajemen paket yang jauh lebih cepat daripada Node.js.
* **Web Framework:** **Hono** – Framework minimalis yang sangat stabil untuk menangani trafik bot.
* **Database:** **bun:sqlite** – Penyimpanan data lokal yang sangat ringan dan kencang untuk menyimpan memori percakapan atau data akademik.
* **NLP Alternatif:** **Compromise.js** – Pengganti spaCy yang sangat ringan untuk parsing bahasa manusia di ekosistem JavaScript.
* **AI Orchestrator:** **LangChain.js** – Pengelola alur logika AI dan koneksi ke model bahasa besar.

---

### **3. Keunggulan Arsitektur Ini**

* **Low Latency:** Kombinasi Bun dan Hono memastikan respon bot terasa sangat instan bagi pengguna.
* **Unified Language:** Seluruh kode (dari server hingga logika AI) menggunakan **TypeScript**, membuatnya lebih mudah dirawat dan dikembangkan.
* **Efficient Memory:** Tidak memerlukan proses Python tambahan, sehingga bisa berjalan di VPS dengan spesifikasi paling rendah sekalipun.

---

### **Identitas Bot Tetap:**

* **Username:** `@CybraFeriBot`
* **Karakter:** Asisten cerdas, futuristik, namun tetap membumi (dengan sentuhan personal dari Feri Lee).