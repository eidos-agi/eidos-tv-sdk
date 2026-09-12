import { resolve } from "node:path";
import { createLabServer } from "./server";
const { server, operatorToken } = createLabServer({
  directory: resolve(process.env.EIDOS_TV_DATA ?? ".eidos-tv/runs"),
  staticDir: resolve("apps/lab/dist"),
  operatorToken: process.env.EIDOS_TV_OPERATOR_TOKEN,
});
const port = Number(process.env.PORT ?? 4317);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Eidos TV Lab: http://127.0.0.1:${port}/#operator=${operatorToken}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
