// sse-mock-server.js
const http = require("http");
const url = require("url");

const PORT = 3001;
const clients = new Set();
let currentIndex = 0;

// Данные для отправки (теперь только то, что идёт в поле data)
const eventsData = [
  {
    // Для INCOMING_CALL
    eventName: "INCOMING_CALL",
    dataPayload: {
      body: {
        candidateId: 656875,
      },
    },
  },
  {
    // Для NEED_ASSIGN_CALL_TO_VACANCY
    eventName: "NEED_ASSIGN_CALL_TO_VACANCY",
    dataPayload: {
      body: {
        candidateId: 656815,
        callId: "MToxMDI0MjIwODo1NDQ6NDY1NTE4NDU5",
      },
    },
  },
];

function sendToAllClients(eventName, dataPayload) {
  // Формируем правильное SSE-сообщение
  const message = `event: ${eventName}\ndata: ${JSON.stringify(dataPayload)}\n\n`;

  console.log(`\n📤 Отправка SSE события:`);
  console.log(`   event: ${eventName}`);
  console.log(`   data: ${JSON.stringify(dataPayload)}`);

  clients.forEach((client) => {
    try {
      client.res.write(message);
    } catch (err) {
      console.log("❌ Ошибка записи клиенту, удаляем");
      clients.delete(client);
    }
  });
}

const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Cache-Control",
      "Access-Control-Allow-Credentials": "true",
    });
    res.end();
    return;
  }

  if (pathname === "/api/sse-notifications") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Credentials": "true",
    });

    const client = { res };
    clients.add(client);
    console.log(`\n✅ Клиент подключен. Всего клиентов: ${clients.size}`);

    // Отправляем первое событие через 1.5 секунды
    setTimeout(() => {
      const { eventName, dataPayload } =
        eventsData[currentIndex % eventsData.length];
      sendToAllClients(eventName, dataPayload);
      currentIndex++;
    }, 1500);

    // Затем отправляем каждые 30 секунд следующее по кругу
    const interval = setInterval(() => {
      const { eventName, dataPayload } =
        eventsData[currentIndex % eventsData.length];
      sendToAllClients(eventName, dataPayload);
      currentIndex++;
    }, 30000);

    req.on("close", () => {
      clearInterval(interval);
      clients.delete(client);
      console.log(`\n❌ Клиент отключен. Осталось клиентов: ${clients.size}`);
    });

    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`SSE Mock Server (корректный формат)

✅ Подключено клиентов: ${clients.size}

События отправляются в правильном SSE формате:
- Отдельная строка event:
- Отдельная строка data: с JSON

Подключение: http://localhost:${PORT}/api/sse-notifications
`);
});

server.listen(PORT, () => {
  console.log(`🚀 SSE Mock Server запущен на http://localhost:${PORT}`);
  console.log(
    `📡 SSE endpoint: http://localhost:${PORT}/api/sse-notifications`,
  );
  console.log(`⏱️ Первое событие через 1.5с, затем каждые 30с`);
  console.log(`✅ Формат сообщений соответствует спецификации SSE`);
});
