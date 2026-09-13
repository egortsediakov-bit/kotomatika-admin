КОТОМАТИКА CRM PRO FRONTEND V3 — SESSION HEADER FIX

Теперь CRM-сессия отправляется через X-Kotomatika-Session вместо Authorization: Bearer.
Это устраняет конфликт с IAM-аутентификацией Yandex Cloud Functions и HTTP 403.

Ставить только вместе с API V7.
После загрузки в GitHub один раз открыть reset-cache.html.
