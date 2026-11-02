/**
 * The fixed 10-sentence set for latency comparisons (same text every run, so numbers compare).
 * Mixed lengths, clauses and scripts; none is secret or personal.
 */
export const LATENCY_SENTENCES: { lang: string; text: string }[] = [
  { lang: 'en', text: 'Good morning everyone, thank you for joining on such short notice.' },
  {
    lang: 'en',
    text: 'Before we start, let me share the agenda: first the budget, then the hiring plan, and finally the schedule for next quarter.',
  },
  { lang: 'en', text: 'Can you hear me clearly?' },
  { lang: 'bn', text: 'সবাইকে শুভ সকাল, এত অল্প সময়ের নোটিশে যোগ দেওয়ার জন্য ধন্যবাদ।' },
  {
    lang: 'bn',
    text: 'শুরু করার আগে আমি আলোচ্যসূচি জানিয়ে দিই: প্রথমে বাজেট, তারপর নিয়োগের পরিকল্পনা, এবং শেষে আগামী প্রান্তিকের সময়সূচি। আপনারা কি আমার কথা পরিষ্কার শুনতে পাচ্ছেন?',
  },
  { lang: 'es', text: 'Buenos días a todos, gracias por conectarse con tan poco aviso.' },
  {
    lang: 'es',
    text: 'Antes de empezar, quiero compartir la agenda: primero el presupuesto, después el plan de contratación y por último el calendario del próximo trimestre.',
  },
  { lang: 'hi', text: 'सभी को सुप्रभात, इतनी कम सूचना पर जुड़ने के लिए धन्यवाद।' },
  { lang: 'ar', text: 'صباح الخير للجميع، شكرًا لانضمامكم في وقت قصير جدًا؛ هل تسمعونني بوضوح؟' },
  {
    lang: 'zh',
    text: '大家早上好，感谢你们在这么短的时间内加入会议，现在我先介绍一下今天的议程安排和各部分的时间。',
  },
]
