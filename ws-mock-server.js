#!/usr/bin/env node

const http = require("http");
const sockjs = require("sockjs");

const PORT = 5500;
const SOCKJS_ENDPOINT = "/socket";
const NOTIFICATION_INTERVAL_MS = 10000;
const NOTIFICATION_ACTION = "[Cabinet] Add notification success";

const subscribers = new Set();
let notificationId = 1;

const MESSAGES_POOL = [
  "📄 Новая заявка на вакансию «Senior Frontend Developer» от кандидата Ивана Смирнова. Требуется первичный скрининг резюме.",
  "🎯 Кандидат Елена Петрова успешно прошла техническое собеседование на позицию «Lead Backend Engineer». Ожидайте решение HR-комитета до пятницы.",
  "✍️ Оффер по вакансии «Team Lead» отправлен кандидату Алексею Кравцову. Срок ответа – 3 рабочих дня.",
  "✅ Вакансия «Data Scientist (middle)» закрыта. Поздравляем с успешным наймом! Оформите документы до конца недели.",
  "❌ Кандидат Дмитрий Козлов отклонил предложение о работе («DevOps Engineer»). Рекомендуем пересмотреть условия или активировать бэкап-кандидата.",
  "📚 Новая заявка на летнюю стажировку от студента МГУ Ивана Фёдорова (направление «Аналитика данных»). Проверьте портфолио.",
  "🎁 HR-бонус: начислено 500 баллов за успешный найм по вакансии «Project Manager». Баллы поступят на счёт в течение часа.",
  "📅 Кандидат Анна Соколова подтвердила выход на работу на позицию «QA Lead» с 1 апреля. Подготовьте рабочее место и доступы.",
  "⏰ Срочно! Вакансия «DevOps Engineer» будет автоматически снята с публикации через 2 дня. Продлите, если поиск ещё не завершён.",
  "⚠️ Модерация: резюме кандидата Алексея Новикова содержит несоответствия. Требуется ручная проверка до подтверждения.",
  "🎉 Оффер по вакансии «Product Manager» подписан обеими сторонами. Приступаем к онбордингу. Поздравляем команду!",
  "📞 Кандидат Мария Кузнецова приглашена на финальное интервью с CTO завтра в 11:00. Не забудьте подтвердить встречу.",
  "💬 У вас 3 непрочитанных сообщений в чате по вакансии «UX/UI Designer». Ответьте кандидатам до вечера.",
  "📊 Отчёт по найму за неделю: 5 новых кандидатов, 2 отправленных оффера, 1 успешный выход. Прогресс хороший!",
  "🔧 Система рекомендует обновить требования к вакансии «Backend Developer (Go)»: добавьте тестовое задание для лучшего отклика.",
];

function generateFullNotification() {
  const id = notificationId++;
  const randomMsg =
    MESSAGES_POOL[Math.floor(Math.random() * MESSAGES_POOL.length)];
  const createdOn = new Date().toISOString();
  return {
    action: NOTIFICATION_ACTION,
    msg: randomMsg,
    response: {
      notification: {
        id,
        message: randomMsg,
        read: false,
        createdOn,
      },
    },
  };
}

function sendStompFrame(conn, command, headers = {}, body = "") {
  let frame = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    frame += `${key}:${value}\n`;
  }
  frame += `\n${body}\0`;
  conn.write(frame);
}

function parseStompFrame(data) {
  const str = data.toString();
  const lines = str.split("\n");
  const command = lines[0].trim();
  const headers = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") break;
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      headers[key] = value;
    }
  }
  let body = "";
  if (i < lines.length) {
    body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/\0$/, "");
  }
  return { command, headers, body };
}

// Отправка одного сообщения конкретному клиенту
function sendNotificationToClient(conn, fullMessage) {
  const bodyJson = JSON.stringify(fullMessage);
  sendStompFrame(
    conn,
    "MESSAGE",
    {
      subscription: "sub-0",
      "message-id": Date.now().toString(),
      destination: "/user/exchange/notification",
      "content-length": Buffer.byteLength(bodyJson),
    },
    bodyJson,
  );
}

// Отправка двух стартовых сообщений при подключении
function sendInitialMessages(conn) {
  for (let i = 0; i < 2; i++) {
    const fullMessage = generateFullNotification();
    console.log(
      `🎆 Стартовое сообщение #${i + 1} клиенту ${conn.id}: ${fullMessage.msg}`,
    );
    sendNotificationToClient(conn, fullMessage);
  }
}

// Рассылка всем подписчикам
function broadcastNotification(fullMessage) {
  if (subscribers.size === 0) return;
  const bodyJson = JSON.stringify(fullMessage);
  console.log(
    `📤 РАССЫЛКА: id=${fullMessage.response.notification.id}, msg="${fullMessage.msg}". Подписчиков: ${subscribers.size}`,
  );
  for (const conn of subscribers) {
    try {
      sendStompFrame(
        conn,
        "MESSAGE",
        {
          subscription: "sub-0",
          "message-id": Date.now().toString(),
          destination: "/user/exchange/notification",
          "content-length": Buffer.byteLength(bodyJson),
        },
        bodyJson,
      );
    } catch (err) {
      console.error(`❌ Ошибка отправки клиенту ${conn.id}: ${err.message}`);
      subscribers.delete(conn);
    }
  }
}

function handleStompConnection(conn) {
  let cookieHeader = conn.headers?.cookie;
  if (!cookieHeader && conn.request?.headers) {
    cookieHeader = conn.request.headers.cookie;
  }
  console.log(`🍪 [${conn.id}] Cookies: ${cookieHeader || "(нет)"}`);

  console.log(`📋 [${conn.id}] Все заголовки:`, conn.headers);

  const sessionId = conn.id;
  console.log(`🔌 [${sessionId}] Новое STOMP-соединение установлено.`);

  let currentSubscriptionId = null;

  conn.on("data", (message) => {
    const raw = message.toString();
    console.log(`📨 [${sessionId}] Получено: ${raw.replace(/\0/g, "\\0")}`);

    const { command, headers, body } = parseStompFrame(raw);

    switch (command) {
      case "CONNECT":
        sendStompFrame(conn, "CONNECTED", {
          version: "1.2",
          "heart-beat": "0,0",
        });
        console.log(`✅ [${sessionId}] Отправлен CONNECTED`);
        break;

      case "SUBSCRIBE":
        currentSubscriptionId = headers.id;
        subscribers.add(conn);
        console.log(
          `📡 [${sessionId}] Подписка на ${headers.destination} (id=${currentSubscriptionId}). Всего подписчиков: ${subscribers.size}`,
        );
        // 👇 ОТПРАВЛЯЕМ ДВА СООБЩЕНИЯ СРАЗУ ПРИ ПОДПИСКЕ
        // sendInitialMessages(conn);
        break;

      case "UNSUBSCRIBE":
        subscribers.delete(conn);
        console.log(
          `🔕 [${sessionId}] Отписка (id=${headers.id}). Всего подписчиков: ${subscribers.size}`,
        );
        break;

      case "SEND":
        console.log(`✈️ [${sessionId}] SEND в ${headers.destination}: ${body}`);
        break;

      case "DISCONNECT":
        subscribers.delete(conn);
        console.log(
          `👋 [${sessionId}] DISCONNECT. Всего подписчиков: ${subscribers.size}`,
        );
        conn.close();
        break;

      default:
        console.log(`⚠️ [${sessionId}] Неизвестная команда: ${command}`);
    }
  });

  conn.on("close", () => {
    subscribers.delete(conn);
    console.log(
      `❌ [${sessionId}] Соединение закрыто. Всего подписчиков: ${subscribers.size}`,
    );
  });

  conn.on("error", (err) => {
    subscribers.delete(conn);
    console.error(`🔥 [${sessionId}] Ошибка: ${err.message}`);
  });
}

// Запуск интервальной рассылки (каждые 5 секунд)
let intervalId = null;
function startIntervalSending() {
  intervalId = setInterval(() => {
    if (subscribers.size === 0) {
      console.log("⏳ Нет активных подписчиков, пропускаем рассылку");
      return;
    }
    const fullMessage = generateFullNotification();
    broadcastNotification(fullMessage);
  }, NOTIFICATION_INTERVAL_MS);
}

// --- Настройка сервера ---
const sockjsServer = sockjs.createServer({
  log: (severity, message) => console.log(`[sockjs] ${severity}: ${message}`),
});
sockjsServer.on("connection", handleStompConnection);

const httpServer = http.createServer();
const ALLOWED_ORIGINS = ["http://localhost:3000", "http://localhost:4200"];

httpServer.on("request", (req, res) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!req.url.startsWith(SOCKJS_ENDPOINT)) {
    res.statusCode = 404;
    res.end("Not found");
  }
});

sockjsServer.installHandlers(httpServer, { prefix: SOCKJS_ENDPOINT });

startIntervalSending();

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     🚀 WebSocket (SockJS + STOMP) MOCK SERVER           ║
║     Порт: ${PORT}                                        ║
║     Endpoint: http://localhost:${PORT}${SOCKJS_ENDPOINT} ║
║     Уведомления каждые ${NOTIFICATION_INTERVAL_MS / 1000} сек   ║
║     При подключении клиент получает 2 сообщения сразу   ║
╚══════════════════════════════════════════════════════════╝
  `);
});

process.on("SIGINT", () => {
  console.log("\n🛑 Остановка сервера...");
  if (intervalId) clearInterval(intervalId);
  httpServer.close(() => process.exit(0));
});
