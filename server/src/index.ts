// index.ts - boot the Selis server: open the archive, start the browser hub,
// then start the master ingest socket. The cluster dials in on its own schedule.
import { config } from "./config";
import { Store } from "./store";
import { Hub } from "./hub";
import { Ingest } from "./ingest";
import { logger } from "./log";

const log = logger("main");

function main(): void {
  log.info("Chimera Lenia - Selis server starting");
  const store = new Store(config.dbPath);
  log.info("archive:", config.dbPath, "acks:", store.acks());

  const hub = new Hub(config, store);
  new Ingest(config, store, hub);

  log.info("ready. waiting for master to dial in...");
}

main();
