import { listen } from "@colyseus/tools";
import appConfig from "./app.config.js";

const port = Number(process.env.PORT ?? 2567);

listen(appConfig, port)
  .then(() => {
    console.log(`Colyseus server listening on ws://localhost:${port}`);
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
