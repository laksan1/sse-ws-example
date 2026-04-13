const http = require("http");
const url = require("url");

const PORT = 3001;
const clients = new Set();

// Четыре разных события для отправки подряд
const eventsData = [
  // {
  //   eventName: "INCOMING_CALL",
  //   dataPayload: { body: { candidateId: 656875 } },
  // },
  {
    eventName: "NEED_ASSIGN_CALL_TO_VACANCY",
    dataPayload: {
      body: { candidateId: 656815, callId: "MToxMDI0MjIwODo1NzE6MTk3NTE4MDIz" },
    },
  },
  // {
  //   eventName: "INCOMING_CALL",
  //   dataPayload: { body: { candidateId: 656876 } },
  // },
  {
    eventName: "NEED_ASSIGN_CALL_TO_VACANCY",
    dataPayload: {
      body: { candidateId: 656817, callId: "MToxMDI0MjIwODo1NzE6MTk3NTE4MDIz" },
    },
  },
];

function sendToAllClients(eventName, dataPayload) {
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

    // Отправляем 4 события с интервалом 500 мс
    eventsData.forEach((event, index) => {
      setTimeout(
        () => {
          sendToAllClients(event.eventName, event.dataPayload);
        },
        500 * (index + 1),
      );
    });

    req.on("close", () => {
      clients.delete(client);
      console.log(`\n❌ Клиент отключен. Осталось клиентов: ${clients.size}`);
    });

    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`SSE Mock Server (4 события подряд с интервалом 500 мс)

✅ Подключено клиентов: ${clients.size}

Подключение: http://localhost:${PORT}/api/sse-notifications
`);
});

server.listen(PORT, () => {
  console.log(`🚀 SSE Mock Server запущен на http://localhost:${PORT}`);
  console.log(
    `📡 SSE endpoint: http://localhost:${PORT}/api/sse-notifications`,
  );
  console.log(`⏱️ Отправка 4 событий с интервалом 500 мс`);
});
