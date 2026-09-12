КОТОМАТИКА Admin

API: https://functions.yandexcloud.net/d4e4i8rj8n22jfjcnmej

Уже работает:
- вход admin + пароль;
- чтение реальных заявок из YDB;
- поиск и фильтры;
- кликабельные телефон и Telegram;
- время автоматически показывается по Москве;
- PWA;
- ответы API с персональными данными не кэшируются.

Публикация:
1. Создать отдельный GitHub-репозиторий kotomatika-admin.
2. Загрузить все файлы из архива в корень.
3. Settings -> Pages -> main -> /(root).
4. В DNS: CNAME admin -> egortsediakov-bit.github.io
5. В GitHub Pages Custom domain: admin.kotomatika.ru
6. Дождаться HTTPS.

Важно: функция Yandex разрешает CORS только для https://admin.kotomatika.ru.
