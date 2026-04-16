#!/usr/bin/env node

const http = require("http");
const sockjs = require("sockjs");

const PORT = 5500;
const SOCKJS_ENDPOINT = "/socket";
const NOTIFICATION_INTERVAL_MS = 10000;
const NOTIFICATION_ACTION = "[Cabinet] Add notification success";

// Хранилище: email -> Set соединений (поддерживает несколько вкладок/соединений на одного пользователя)
const userConnections = new Map(); // Map<string, Set<object>>
let notificationId = 1;

/**
 * Генерирует персонализированное уведомление для указанного пользователя.
 * В тексте сообщения явно видно, кому оно адресовано.
 */
function generatePersonalNotification(userEmail) {
  const id = notificationId++;
  const messageText = `🔔 Персональное уведомление для ${userEmail}: Это тестовое сообщение, отправленное только вам (ID уведомления ${id}).`;
  const createdOn = new Date().toISOString();
  return {
    action: NOTIFICATION_ACTION,
    msg: messageText,
    response: {
      notification: {
        id,
        message: messageText,
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

// Добавление соединения в Map по email
function addUserConnection(email, conn) {
  if (!userConnections.has(email)) {
    userConnections.set(email, new Set());
  }
  userConnections.get(email).add(conn);
  console.log(
    `👤 Пользователь ${email} добавлен. Всего пользователей: ${userConnections.size}`,
  );
  // Выводим детальную статистику по вкладкам
  printConnectionStats();
}

// Удаление соединения из Map
function removeUserConnection(conn) {
  for (const [email, connections] of userConnections.entries()) {
    if (connections.has(conn)) {
      connections.delete(conn);
      if (connections.size === 0) {
        userConnections.delete(email);
        console.log(
          `👤 Пользователь ${email} удалён (нет активных соединений).`,
        );
      } else {
        console.log(
          `👤 У пользователя ${email} осталось ${connections.size} соединений.`,
        );
      }
      break;
    }
  }
  printConnectionStats();
}

// Вывод статистики: сколько пользователей и сколько вкладок (соединений) у каждого
function printConnectionStats() {
  console.log("\n📊 Статистика подключений:");
  if (userConnections.size === 0) {
    console.log("   Нет активных пользователей.");
  } else {
    console.log(`   Всего пользователей: ${userConnections.size}`);
    for (const [email, connections] of userConnections.entries()) {
      console.log(`   - ${email}: ${connections.size} вкладок/соединений`);
    }
  }
  console.log(""); // пустая строка для разделения
}

// Отправка уведомления конкретному пользователю (всем его соединениям)
function sendNotificationToUser(email, fullMessage) {
  const connections = userConnections.get(email);
  if (!connections || connections.size === 0) {
    console.log(`⚠️ Нет активных соединений для пользователя ${email}`);
    return;
  }
  const bodyJson = JSON.stringify(fullMessage);
  for (const conn of connections) {
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
      console.error(`❌ Ошибка отправки пользователю ${email}: ${err.message}`);
      connections.delete(conn);
      if (connections.size === 0) userConnections.delete(email);
    }
  }
  console.log(
    `📤 Отправлено уведомление пользователю ${email}: ${fullMessage.msg}`,
  );
}

// Рассылка персонализированных уведомлений всем активным пользователям
function broadcastToAllUsers() {
  if (userConnections.size === 0) {
    console.log("⏳ Нет активных пользователей, пропускаем рассылку");
    return;
  }
  console.log(
    `\n🔄 Начинаем рассылку персонализированных уведомлений (${new Date().toISOString()})`,
  );
  for (const email of userConnections.keys()) {
    const fullMessage = generatePersonalNotification(email);
    sendNotificationToUser(email, fullMessage);
  }
  // Дополнительно выводим статистику после рассылки
  printConnectionStats();
}

function handleStompConnection(conn) {
  let userEmail = null;

  console.log(`📋 [${conn.id}] Заголовки подключения:`, conn.headers);

  conn.on("data", (message) => {
    const raw = message.toString();
    console.log(`📨 [${conn.id}] Получено: ${raw.replace(/\0/g, "\\0")}`);

    const { command, headers, body } = parseStompFrame(raw);

    switch (command) {
      case "CONNECT":
        // Извлекаем email из заголовка Authorization
        const authHeader = headers["authorization"] || headers["Authorization"];
        if (authHeader && authHeader.startsWith("Bearer ")) {
          userEmail = authHeader.slice(7);
          console.log(`🔑 [${conn.id}] Аутентифицирован как: ${userEmail}`);
        } else {
          console.warn(
            `⚠️ [${conn.id}] Нет Authorization заголовка, подписка невозможна`,
          );
          conn.close();
          return;
        }
        addUserConnection(userEmail, conn);
        sendStompFrame(conn, "CONNECTED", {
          version: "1.2",
          "heart-beat": "0,0",
        });
        console.log(`✅ [${conn.id}] Отправлен CONNECTED для ${userEmail}`);
        break;

      case "SUBSCRIBE":
        console.log(
          `📡 [${conn.id}] Подписка на ${headers.destination} (id=${headers.id}) пользователем ${userEmail}`,
        );
        break;

      case "UNSUBSCRIBE":
        console.log(
          `🔕 [${conn.id}] Отписка (id=${headers.id}) пользователем ${userEmail}`,
        );
        break;

      case "SEND":
        console.log(`✈️ [${conn.id}] SEND в ${headers.destination}: ${body}`);
        break;

      case "DISCONNECT":
        if (userEmail) removeUserConnection(conn);
        console.log(
          `👋 [${conn.id}] DISCONNECT от ${userEmail || "неизвестного пользователя"}`,
        );
        conn.close();
        break;

      default:
        console.log(`⚠️ [${conn.id}] Неизвестная команда: ${command}`);
    }
  });

  conn.on("close", () => {
    if (userEmail) removeUserConnection(conn);
    console.log(
      `❌ [${conn.id}] Соединение закрыто (${userEmail || "не аутентифицирован"})`,
    );
  });

  conn.on("error", (err) => {
    console.error(`🔥 [${conn.id}] Ошибка: ${err.message}`);
    if (userEmail) removeUserConnection(conn);
  });
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

// Запускаем интервальную рассылку персонализированных уведомлений
let intervalId = setInterval(() => {
  broadcastToAllUsers();
}, NOTIFICATION_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     🚀 WebSocket (SockJS + STOMP) MOCK SERVER           ║
║     Порт: ${PORT}                                        ║
║     Endpoint: http://localhost:${PORT}${SOCKJS_ENDPOINT} ║
║     Уведомления каждые ${NOTIFICATION_INTERVAL_MS / 1000} сек   ║
║     Персонализация: каждому пользователю своё сообщение ║
║     Текст сообщения содержит email получателя           ║
╚══════════════════════════════════════════════════════════╝
  `);
  console.log(`
💡 ВНИМАНИЕ: На клиенте (Angular) при инициализации STOMP-клиента обязательно укажите:
    this.stompClient = new Client({
      webSocketFactory: () => new SockJS('http://localhost:5500/socket'),
      connectHeaders: {
        Authorization: \`Bearer \${this.userInfo().email}\`
      },
      // ... остальные настройки
    });
  `);
});

process.on("SIGINT", () => {
  console.log("\n🛑 Остановка сервера...");
  clearInterval(intervalId);
  httpServer.close(() => process.exit(0));
});
